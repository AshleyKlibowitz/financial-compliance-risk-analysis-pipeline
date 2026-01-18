// Write a simple Go HTTP server using the standard library. It should listen on port 8080. It needs one endpoint /risk that accepts a POST request with JSON payload {'amount': float}. If the amount is greater than 10000, return {'status': 'high_risk'}, otherwise return {'status': 'accepted'}. Use structs for JSON decoding/encoding.

package main

import (
	"encoding/json"
	"net/http"
	"log"
)

type RiskRequest struct {
	Amount float64 `json:"amount"`
}
type Transaction struct {
	Amount   float64 `json:"amount"`
	Merchant string  `json:"merchant"`
}

func checkRisk(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	var t Transaction
	if err := json.NewDecoder(r.Body).Decode(&t); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	riskLevel := "LOW"

	// --- NEW LOGIC START ---

	// 1. The "Coffee Shop Anomaly" Rule
	// If you spend over $500 at a coffee shop, that is suspicious.
	if t.Merchant == "Starbucks" && t.Amount > 500 {
		riskLevel = "HIGH"

	// 2. The "Tech Store Exception" Rule
	// Spending $2,000 at Apple is normal, so we keep it LOW (overriding the default $1000 rule).
	} else if t.Merchant == "Apple Store" && t.Amount < 5000 {
		riskLevel = "LOW"

	// 3. The Standard Default Rules
	} else if t.Amount > 10000 {
		riskLevel = "HIGH"
	} else if t.Amount > 1000 {
		riskLevel = "MEDIUM"
	}
	// --- NEW LOGIC END ---

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"risk_level": riskLevel})
}

func main() {
	http.HandleFunc("/risk", checkRisk)

	log.Println("Starting server on :8080...")
	if err := http.ListenAndServe(":8080", nil); err != nil {
		log.Fatal(err)
	}
}
