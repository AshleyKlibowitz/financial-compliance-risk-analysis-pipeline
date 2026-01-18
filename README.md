# FinGuard: Financial Compliance & Risk Analytics Pipeline

## 📖 Project Overview

This repository documents the end-to-end development of a **Financial Compliance & Risk Analytics Pipeline** designed for modern fintech environments. The goal of this project is to demonstrate **Cloud-Native Systems Engineering**: from the architectural task of orchestrating polyglot microservices to the business task of detecting Anti-Money Laundering (AML) anomalies in real-time. It highlights the ability to decouple high-performance logic, manage hybrid data persistence (AWS DynamoDB with local fallbacks), and visualize risk patterns via a reactive dashboard.

## ⚙️ Technical Highlights

This project displays technical proficiency across two distinct phases of the software lifecycle:

### Phase 1: Microservices Architecture (Polyglot Engine)
* **Decoupled Computation:** Designed a specialized "Risk Engine" using **Go (Golang)** to handle stateless, high-performance mathematical validation, ensuring valid transactions don't suffer latency penalties.
* **API Orchestration:** Built a **Python (FastAPI)** gateway to handle identity management (OAuth 2.0), data validation, and service-to-service communication via Docker networking.

### Phase 2: Intelligence & Resilience (Hybrid Storage)
* **Smart Fallback Storage:** Engineered a resilience layer that automatically detects environment credentials. The system pushes data to **AWS DynamoDB** in production but seamlessly degrades to an **In-Memory Store** for local testing, ensuring zero-configuration deployment for reviewers.
* **Context-Aware Heuristics:** Implemented logic that goes beyond simple thresholds, analyzing **Merchant Context** to differentiate between routine spending and anomalies (e.g., flagging a high-value coffee charge vs. a high-value electronics purchase).

## 🔍 Analytical Logic (Key Metrics)

The table below illustrates how raw transaction payloads were transformed into actionable compliance flags during the analysis:

| Feature | Raw Telemetry (Input) | Business Insight (Output) |
| :--- | :--- | :--- |
| **AML Thresholds** | `amount: $15,000.00` | **High Risk:** Exceeds federal reporting limits (> $10k). |
| **Merchant Anomaly** | `merchant: "Starbucks"`, `amount: $600` | **High Risk:** Transaction value deviates >500% from merchant average. |
| **Trusted Override** | `merchant: "Apple Store"`, `amount: $2,500` | **Low Risk:** High value is expected for this specific vendor category. |
| **Micro-Transactions** | `amount: $12.50` | **Low Risk:** Auto-approval path for high-velocity, low-value volume. |

## 📊 Dashboard Visualization

A React-based Compliance View demonstrating the real-time flagging of high-value anomalies and the "Recent Checks" audit trail.

<div align="center">
<img width="1075" height="867" alt="Screenshot 2026-01-17 at 9 33 51 PM" src="https://github.com/user-attachments/assets/3517ea4b-c9dc-48f0-9724-9d7f89dbd0f8" />
</div>

## ✨ Functional Features

### 1. The Engineering Pipeline
* **Container Orchestration:** A `docker-compose` setup that creates a private network for the Python and Go services to communicate securely, exposing only the Frontend and API Gateway to the host.
* **Identity Management:** Integrated Google OAuth 2.0 flow to simulate enterprise Single Sign-On (SSO) requirements for compliance officers.

### 2. Safety Intelligence & Feedback
* **Instant Feedback Loop:** Asynchronous communication between the Frontend, Python Gateway, and Go Engine provides sub-100ms risk assessments.
* **Visual Risk Tiers:** Dynamic UI styling in Tailwind CSS that translates raw API status codes (`200`, `403`) into human-readable visual cues (Green/Yellow/Red badges).

## 🛠️ Technology Stack

* **Risk Engine:** Go (Standard Library, JSON handling)
* **API Gateway:** Python (FastAPI, Pydantic, HTTPX)
* **Frontend:** React (TypeScript, Vite, Tailwind CSS, Recharts)
* **Database:** AWS DynamoDB (Production) / In-Memory (Dev)
* **Infrastructure:** Docker & Docker Compose

## 🗄️ File Structure

The repository is organized to facilitate a review of the microservices pipeline.

> **Note:** Dependency folders (`node_modules`, `venv`, `__pycache__`) are excluded from this repository to maintain a lightweight codebase. They are automatically regenerated during the Docker build process.

* `/backend-go/main.go`: The high-performance logic that applies context rules to transaction amounts.
* `/backend-python/app.py`: The gateway script handling Auth, DB connections, and routing.
* `/frontend-react/src/`: The TypeScript source code for the interactive compliance dashboard.
* `/docker-compose.yml`: The infrastructure-as-code definition for the multi-container environment.

## 🚀 Installation & Usage

### Clone the Repository
```bash
git clone https://github.com/yourusername/finguard.git
cd finguard
```

## 🐳 Run the Pipeline (Docker)

Build and start all services using Docker Compose:

```bash
docker-compose up --build
```

## 📊 Usage

Open the dashboard:
[http://localhost:5174]

### Test Scenarios

Trigger a Context Anomaly:
- Merchant: Starbucks
- Amount: 1000

Trigger an AML Threshold Event:
- Merchant: any
- Amount: 15000

## ☁️ Optional: AWS Integration

To enable cloud persistence (DynamoDB), create a `.env` file in the project root.
If credentials are not provided, the system defaults to local in-memory storage.

```env
DDB_TABLE=Transactions
AWS_ACCESS_KEY_ID=your_key
AWS_SECRET_ACCESS_KEY=your_secret
```
