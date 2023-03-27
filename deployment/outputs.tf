
output "service_registry" {
  value = {
    auth_type: module.service_registry.auth_type
    service_url: module.service_registry.service_url
  }
}

output "upload_bucket" {
  value = aws_s3_bucket.upload.bucket
}
