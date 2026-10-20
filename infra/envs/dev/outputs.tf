output "url" {
  description = "Public HTTPS URL of the dev portal."
  value       = "https://${aws_cloudfront_distribution.portal.domain_name}"
}

output "instance_id" {
  description = "Use with: aws ssm start-session --target <instance_id>"
  value       = aws_instance.portal.id
}

output "github_deploy_role_arn" {
  description = "Set as the GitHub repository variable AWS_DEV_DEPLOY_ROLE_ARN."
  value       = aws_iam_role.github_deploy.arn
}

output "ecr_repositories" {
  value = { for key, repository in aws_ecr_repository.portal : key => repository.repository_url }
}

output "deploy_parameter_path" {
  description = "SSM path read by scripts/aws/deploy-dev.sh."
  value       = "${local.param_prefix}/deploy"
}

output "alerts_topic_arn" {
  description = "Subscribe yourself to receive alarm and budget notifications."
  value       = aws_sns_topic.alerts.arn
}
