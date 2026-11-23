output "role_arns" {
  description = "GitHub role ARNs. tf-apply appears only after its environment is declared protected."
  value       = { for key, role in aws_iam_role.github : key => role.arn }
}

output "apply_environment" {
  description = "GitHub Environment the apply role trusts."
  value       = local.apply_environment
}
