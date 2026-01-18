from fastapi import FastAPI, Request
from pydantic import BaseModel

app = FastAPI()


class RiskRequest(BaseModel):
    amount: float
    merchant: str | None = None


@app.post("/risk")
async def risk(req: RiskRequest):
    # Tiered logic: LOW (0-1000), MEDIUM (1000-10000), HIGH (>10000)
    if req.amount > 10000:
        level = "HIGH"
    elif req.amount > 1000:
        level = "MEDIUM"
    else:
        level = "LOW"

    return {"risk_level": level}
