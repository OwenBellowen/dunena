output "cluster_name" {
  description = "ECS cluster name"
  value       = aws_ecs_cluster.dunena.name
}

output "service_name" {
  description = "ECS service name"
  value       = aws_ecs_service.dunena.name
}

output "efs_id" {
  description = "EFS filesystem ID for data persistence"
  value       = aws_efs_file_system.dunena.id
}
