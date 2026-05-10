# ── Dunena Terraform Module: AWS ECS Fargate ────────────────
# Deploys Dunena on ECS Fargate with ALB and EFS persistence.

terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.region
}

# ── VPC & Networking ────────────────────────────────────────

data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

# ── ECS Cluster ─────────────────────────────────────────────

resource "aws_ecs_cluster" "dunena" {
  name = "${var.name}-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

# ── EFS for Persistent Storage ──────────────────────────────

resource "aws_efs_file_system" "dunena" {
  creation_token = "${var.name}-efs"
  encrypted      = true

  tags = {
    Name = "${var.name}-data"
  }
}

resource "aws_efs_mount_target" "dunena" {
  for_each        = toset(slice(data.aws_subnets.default.ids, 0, min(2, length(data.aws_subnets.default.ids))))
  file_system_id  = aws_efs_file_system.dunena.id
  subnet_id       = each.value
  security_groups = [aws_security_group.efs.id]
}

resource "aws_security_group" "efs" {
  name_prefix = "${var.name}-efs-"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    from_port       = 2049
    to_port         = 2049
    protocol        = "tcp"
    security_groups = [aws_security_group.service.id]
  }
}

# ── IAM ─────────────────────────────────────────────────────

resource "aws_iam_role" "task_execution" {
  name = "${var.name}-task-exec"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "task_execution" {
  role       = aws_iam_role.task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# ── Task Definition ─────────────────────────────────────────

resource "aws_ecs_task_definition" "dunena" {
  family                   = var.name
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = aws_iam_role.task_execution.arn

  volume {
    name = "dunena-data"
    efs_volume_configuration {
      file_system_id = aws_efs_file_system.dunena.id
      root_directory = "/"
    }
  }

  container_definitions = jsonencode([{
    name      = "dunena"
    image     = var.image
    essential = true

    portMappings = [{
      containerPort = 3000
      protocol      = "tcp"
    }]

    environment = [
      { name = "DUNENA_PORT", value = "3000" },
      { name = "DUNENA_HOST", value = "0.0.0.0" },
      { name = "DUNENA_MAX_ENTRIES", value = tostring(var.max_entries) },
      { name = "DUNENA_DB", value = "true" },
      { name = "DUNENA_DB_PATH", value = "/var/lib/dunena/dunena.db" },
      { name = "DUNENA_PERSIST", value = "true" },
      { name = "DUNENA_PERSIST_PATH", value = "/var/lib/dunena/dunena-snapshot.json" },
    ]

    mountPoints = [{
      sourceVolume  = "dunena-data"
      containerPath = "/var/lib/dunena"
      readOnly      = false
    }]

    healthCheck = {
      command     = ["CMD-SHELL", "bun -e \"fetch('http://localhost:3000/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\""]
      interval    = 20
      timeout     = 5
      retries     = 3
      startPeriod = 15
    }

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = "/ecs/${var.name}"
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = "dunena"
        "awslogs-create-group"  = "true"
      }
    }
  }])
}

# ── Security Group ──────────────────────────────────────────

resource "aws_security_group" "service" {
  name_prefix = "${var.name}-svc-"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    from_port   = 3000
    to_port     = 3000
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# ── ECS Service ─────────────────────────────────────────────

resource "aws_ecs_service" "dunena" {
  name            = var.name
  cluster         = aws_ecs_cluster.dunena.id
  task_definition = aws_ecs_task_definition.dunena.arn
  desired_count   = 1 # Single instance due to SQLite
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = slice(data.aws_subnets.default.ids, 0, min(2, length(data.aws_subnets.default.ids)))
    security_groups  = [aws_security_group.service.id]
    assign_public_ip = true
  }
}
