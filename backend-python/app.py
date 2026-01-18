from fastapi import FastAPI, HTTPException, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import httpx
import json
from google.oauth2 import id_token as google_id_token
from google.auth.transport import requests as google_requests
from pydantic import BaseModel
import os
import time
import uuid
try:
    import boto3
    from botocore.exceptions import BotoCoreError, ClientError
except Exception:
    boto3 = None

app = FastAPI()

# Development CORS: allow the Vite dev server and localhost
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:5174", "http://127.0.0.1:5174"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class Transaction(BaseModel):
    amount: float
    currency: str
    merchant: str
    high_risk: bool = False
    risk_level: Optional[str] = None


# In-memory fallback store (used if DynamoDB not configured)
transactions_store: list[dict] = []


def save_transaction_record(record: dict):
    """Save transaction to DynamoDB if configured, otherwise append to in-memory store."""
    table_name = os.getenv("DDB_TABLE")
    if boto3 and table_name:
        try:
            dynamo = boto3.resource("dynamodb")
            table = dynamo.Table(table_name)
            table.put_item(Item=record)
            return True
        except (BotoCoreError, ClientError) as e:
            print(f"DynamoDB save failed: {e}")
    # fallback
    transactions_store.insert(0, record)
    # keep store size reasonable
    if len(transactions_store) > 200:
        transactions_store.pop()
    return False


@app.post("/transactions")
async def create_transaction(transaction: Transaction, x_user: Optional[str] = Header(None), authorization: Optional[str] = Header(None)):
    # Support Google ID tokens sent as `Authorization: Bearer <id_token>`.
    user_header = None
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1]
        try:
            # Optionally validate audience if provided in env
            audience = os.getenv("GOOGLE_OAUTH_CLIENT_ID")
            request = google_requests.Request()
            payload = google_id_token.verify_oauth2_token(token, request, audience) if audience else google_id_token.verify_oauth2_token(token, request)
            # payload contains email and name
            user_header = json.dumps({"name": payload.get("name"), "email": payload.get("email")})
        except Exception as e:
            print(f"Google token verification failed: {e}")
            raise HTTPException(status_code=401, detail="Invalid Google ID token")
    elif x_user:
        user_header = x_user

    if not user_header:
        raise HTTPException(status_code=401, detail="Missing authentication. Provide Authorization Bearer token or X-User header.")
    risk_data = {}
    RISK_SERVICE_URL = os.getenv("RISK_SERVICE_URL", "http://localhost:8080/risk")
    try:
        async with httpx.AsyncClient() as client:
            risk_response = await client.post(
                RISK_SERVICE_URL,
                json={"amount": transaction.amount, "merchant": transaction.merchant},
                timeout=5.0,
            )
            # prefer JSON, but guard against malformed replies
            try:
                risk_data = risk_response.json()
            except Exception:
                risk_data = {}
    except Exception as e:
        # In dev/demo, don't fail the whole request when risk service is unavailable.
        # Log and continue with a safe default (not flagged) — we'll apply a local heuristic below.
        print(f"Risk service error: {e}")
        risk_data = {}

    # Configurable local heuristic fallback
    try:
        HIGH_RISK_AMOUNT = int(os.getenv("HIGH_RISK_AMOUNT", "10000"))
    except Exception:
        HIGH_RISK_AMOUNT = 10000

    is_high = False
    risk_level = (risk_data.get("risk_level") if isinstance(risk_data, dict) else None)

    if risk_level == "HIGH":
        is_high = True
    elif risk_level == "MEDIUM":
        is_high = False
    elif risk_level == "LOW":
        is_high = False
    else:
        # fallback rule: large amounts are high risk
        if transaction.amount >= HIGH_RISK_AMOUNT:
            is_high = True

    transaction.high_risk = bool(is_high)

    # Ensure we return a risk_level string for the frontend to display
    if risk_level in ("HIGH", "MEDIUM", "LOW"):
        transaction.risk_level = risk_level
    else:
        # Derive risk_level from amount tiers if service didn't provide one
        if transaction.amount > 10000:
            transaction.risk_level = "HIGH"
        elif transaction.amount > 1000:
            transaction.risk_level = "MEDIUM"
        else:
            transaction.risk_level = "LOW"

    # Build record with timestamp and id
    record = {
        "id": str(uuid.uuid4()),
        "timestamp": int(time.time()),
        "user": user_header,
        "amount": float(transaction.amount),
        "currency": transaction.currency,
        "merchant": transaction.merchant,
        "risk_level": transaction.risk_level,
        "high_risk": bool(transaction.high_risk),
    }

    # persist
    saved_to_ddb = save_transaction_record(record)
    if saved_to_ddb:
        print("Saved transaction to DynamoDB")
    else:
        print("Stored transaction in local store")

    return {**record}


class TokenBody(BaseModel):
    id_token: str


@app.post("/auth/verify")
async def verify_id_token(body: TokenBody):
    """Debug endpoint: verify an ID token and return the payload. Useful for testing tokens.

    POST JSON: {"id_token": "..."}
    """
    token = body.id_token
    if not token:
        raise HTTPException(status_code=400, detail="Missing id_token in body")
    try:
        audience = os.getenv("GOOGLE_OAUTH_CLIENT_ID")
        request = google_requests.Request()
        payload = google_id_token.verify_oauth2_token(token, request, audience) if audience else google_id_token.verify_oauth2_token(token, request)
        return {"ok": True, "payload": payload}
    except Exception as e:
        print(f"Token verify failed: {e}")
        raise HTTPException(status_code=401, detail=f"Token verification failed: {e}")


@app.get("/auth/config")
async def auth_config():
    """Return OAuth client configuration for the frontend to consume in dev.

    Returns JSON: { client_id, project_id }
    """
    client_id = os.getenv("GOOGLE_OAUTH_CLIENT_ID")
    project_id = os.getenv("GOOGLE_PROJECT_ID")
    return {"client_id": client_id, "project_id": project_id}


@app.get("/transactions")
async def list_transactions(limit: int = 20, x_user: Optional[str] = Header(None)):
    """Return recent transactions from DynamoDB (if configured) or in-memory store.

    If `X-User` header is provided, filter results to records matching that user string
    or the contained email when JSON is provided.
    """
    table_name = os.getenv("DDB_TABLE")
    items = []
    if boto3 and table_name:
        try:
            dynamo = boto3.resource("dynamodb")
            table = dynamo.Table(table_name)
            resp = table.scan(Limit=limit)
            items = resp.get("Items", [])
            # sort by timestamp desc
            items = sorted(items, key=lambda x: int(x.get("timestamp", 0)), reverse=True)[:limit]
        except (BotoCoreError, ClientError) as e:
            print(f"DynamoDB fetch failed: {e}")
            items = transactions_store[:limit]
    else:
        items = transactions_store[:limit]

    # If x_user supplied, attempt to filter by exact user string or by email inside JSON
    if x_user:
        def extract_email(s: str) -> Optional[str]:
            try:
                import json
                j = json.loads(s)
                return j.get("email")
            except Exception:
                return None

        hdr_email = extract_email(x_user)
        filtered = []
        for it in items:
            u = it.get("user")
            if not u:
                continue
            if u == x_user:
                filtered.append(it)
                continue
            # try to match by email inside stored user (if stored as JSON string)
            stored_email = extract_email(u) if isinstance(u, str) else None
            if hdr_email and stored_email and hdr_email == stored_email:
                filtered.append(it)
                continue
        items = filtered[:limit]

    return {"items": items}


@app.delete("/transactions")
async def clear_transactions():
    """Clear in-memory transaction store. If DynamoDB is configured, this is disabled unless ALLOW_CLEAR env var is set."""
    table_name = os.getenv("DDB_TABLE")
    allow_clear = os.getenv("ALLOW_CLEAR", "false").lower() in ("1", "true", "yes")
    if table_name and not allow_clear:
        raise HTTPException(status_code=403, detail="Clearing DynamoDB-backed records is disabled in this environment.")
    transactions_store.clear()
    return {"ok": True}
