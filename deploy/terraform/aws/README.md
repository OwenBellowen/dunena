# Dunena AWS Terraform Module

Deploy Dunena on AWS ECS Fargate with EFS persistent storage.

## Architecture

- **ECS Fargate** — serverless container execution (no EC2 management)
- **EFS** — encrypted persistent filesystem for SQLite database and snapshots
- **CloudWatch** — centralized logging via awslogs driver
- **Security Groups** — isolated networking for ECS tasks and EFS mounts

## Usage

```hcl
module "dunena" {
  source = "./deploy/terraform/aws"

  name        = "dunena-prod"
  region      = "us-east-1"
  image       = "ghcr.io/powencu/dunena:0.3.1"
  cpu         = "1024"
  memory      = "2048"
  max_entries = 500000
}
```

## Quick Start

```bash
cd deploy/terraform/aws
terraform init
terraform plan
terraform apply
```

## Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `name` | `dunena` | Name prefix for all resources |
| `region` | `us-east-1` | AWS region |
| `image` | `ghcr.io/powencu/dunena:latest` | Container image |
| `cpu` | `512` | Fargate CPU (256–4096) |
| `memory` | `1024` | Fargate memory in MiB |
| `max_entries` | `100000` | Cache max entries |

## ⚠️ Important Notes

- **Single replica only**: SQLite is single-writer. The ECS service is configured with `desired_count = 1`.
- **EFS latency**: EFS adds ~1–3ms latency per I/O operation compared to local SSD. Consider enabling WAL mode in SQLite for better write performance.
- **Cost**: A 512 CPU / 1024 MiB Fargate task costs ~$15/month. EFS charges ~$0.30/GB/month.
