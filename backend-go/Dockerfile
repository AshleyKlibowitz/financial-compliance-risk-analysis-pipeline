FROM golang:1.20-alpine AS builder
WORKDIR /src
RUN apk add --no-cache git
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o /out/risk-service .

FROM alpine:3.18
RUN apk add --no-cache ca-certificates
COPY --from=builder /out/risk-service /usr/local/bin/risk-service
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/risk-service"]
# Write a multi-stage Dockerfile for this Go application. Build it using golang:alpine and run it using a scratch or alpine image to keep it small. Expose port 8080.

# Build stage
FROM golang:alpine AS builder2
WORKDIR /app
COPY . .
RUN go build -o risk-engine main.go

# Run stage
FROM alpine:latest
WORKDIR /app
COPY --from=builder2 /app/risk-engine .
EXPOSE 8080
CMD ["./risk-engine"]
