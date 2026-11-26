output "state_bucket" {
  description = "Pass to `terraform init -backend-config=bucket=...`."
  value       = aws_s3_bucket.state.bucket
}

output "lambda_boundary_arn" {
  description = "Boundary of every execution role."
  value       = aws_iam_policy.lambda_boundary.arn
}

output "github_role_arns" {
  description = "GitHub OIDC roles."
  value       = module.github_roles.role_arns
}
