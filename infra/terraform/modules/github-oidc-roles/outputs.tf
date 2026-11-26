output "role_arns" {
  description = "GitHub role ARNs. app-deploy and tf-apply appear only after their environments are declared protected."
  value       = { for key, role in aws_iam_role.github : key => role.arn }
}

output "deploy_environment" {
  description = "GitHub Environment the deploy role trusts."
  value       = local.deploy_environment
}

output "apply_environment" {
  description = "GitHub Environment the apply role trusts."
  value       = local.apply_environment
}
