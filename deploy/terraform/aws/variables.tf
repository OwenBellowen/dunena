variable "name" {
  description = "Name prefix for all resources"
  type        = string
  default     = "dunena"
}

variable "region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "image" {
  description = "Docker image for Dunena"
  type        = string
  default     = "ghcr.io/powencu/dunena:latest"
}

variable "cpu" {
  description = "Fargate task CPU (in CPU units)"
  type        = string
  default     = "512"
}

variable "memory" {
  description = "Fargate task memory (in MiB)"
  type        = string
  default     = "1024"
}

variable "max_entries" {
  description = "Maximum cache entries"
  type        = number
  default     = 100000
}
