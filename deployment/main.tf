#########################
# Provider registration
#########################

provider "aws" {
  profile = var.aws_profile
  region  = var.aws_region
}

provider "mcma" {
  service_registry_url = module.service_registry.service_url

  aws4_auth {
    profile = var.aws_profile
    region  = var.aws_region
  }
}

############################################
# Cloud watch log group for central logging
############################################

resource "aws_cloudwatch_log_group" "main" {
  name = "/mcma/${var.global_prefix}"
}

#########################
# Service Registry Module
#########################

module "service_registry" {
  source = "https://ch-ebu-mcma-module-repository.s3.eu-central-1.amazonaws.com/ebu/service-registry/aws/0.16.0/module.zip"

  prefix = "${var.global_prefix}-service-registry"

  stage_name = var.environment_type

  aws_region     = var.aws_region
  aws_profile    = var.aws_profile

  log_group                   = aws_cloudwatch_log_group.main
  api_gateway_metrics_enabled = true
  xray_tracing_enabled        = true
  enhanced_monitoring_enabled = true
}

#########################
# Job Processor Module
#########################

module "job_processor" {
  source = "https://ch-ebu-mcma-module-repository.s3.eu-central-1.amazonaws.com/ebu/job-processor/aws/0.16.0/module.zip"

  prefix = "${var.global_prefix}-job-processor"

  stage_name     = var.environment_type
  dashboard_name = var.global_prefix

  aws_region     = var.aws_region

  service_registry = module.service_registry
  execute_api_arns = [
    "${module.service_registry.aws_apigatewayv2_api.service_api.execution_arn}/${var.environment_type}/*/*",
    "${module.ffmpeg_service.aws_apigatewayv2_api.service_api.execution_arn}/${var.environment_type}/*/*",
  ]

  log_group                   = aws_cloudwatch_log_group.main
  api_gateway_metrics_enabled = true
  xray_tracing_enabled        = true
}

########################################
# FFmpeg Service
########################################

module "ffmpeg_service" {
  source = "../aws/build/staging"

  prefix = "${var.global_prefix}-ffmpeg-service"

  stage_name = var.environment_type
  aws_region = var.aws_region

  service_registry = module.service_registry
  execute_api_arns = [
    "${module.service_registry.aws_apigatewayv2_api.service_api.execution_arn}/${var.environment_type}/*/*",
    "${module.job_processor.aws_apigatewayv2_api.service_api.execution_arn}/${var.environment_type}/*/*",
  ]

  log_group = aws_cloudwatch_log_group.main
  api_gateway_metrics_enabled = true
  xray_tracing_enabled        = true
}

########################################
# Bucket for testing
########################################
resource "aws_s3_bucket" "upload" {
  bucket = "${var.global_prefix}-upload-${var.aws_region}"

  lifecycle {
    ignore_changes = [
      lifecycle_rule
    ]
  }

  force_destroy = true
}

resource "aws_s3_bucket_lifecycle_configuration" "upload" {
  bucket = aws_s3_bucket.upload.id

  rule {
    id     = "Delete after 1 day"
    status = "Enabled"
    expiration {
      days = 1
    }
  }
}

resource "aws_s3_bucket_public_access_block" "upload" {
  bucket = aws_s3_bucket.upload.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
