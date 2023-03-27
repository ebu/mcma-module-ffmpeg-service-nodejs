resource "mcma_service" "service" {
  depends_on = [
    aws_apigatewayv2_api.service_api,
    aws_apigatewayv2_integration.service_api,
    aws_apigatewayv2_route.service_api_default,
    aws_apigatewayv2_route.service_api_options,
    aws_apigatewayv2_stage.service_api,
    aws_dynamodb_table.service_table,
    aws_iam_role.api_handler,
    aws_iam_role_policy.api_handler,
    aws_lambda_function.api_handler,
    aws_lambda_permission.service_api_default,
    aws_lambda_permission.service_api_options,
  ]

  name      = var.name
  auth_type = local.service_auth_type
  job_type  = "TransformJob"

  resource {
    resource_type = "JobAssignment"
    http_endpoint = "${local.service_url}/job-assignments"
  }

  job_profile_ids = [
    mcma_job_profile.extract_audio.id,
    mcma_job_profile.extract_thumbnail.id,
    mcma_job_profile.transcode.id,
  ]
}

resource "mcma_job_profile" "extract_audio" {
  name = "FFmpegExtractAudio"

  input_parameter {
    name = "inputFile"
    type = "Locator"
  }

  input_parameter {
    name     = "outputFormat"
    type     = "string"
    optional = true
  }

  output_parameter {
    name = "outputFile"
    type = "S3Locator"
  }
}

resource "mcma_job_profile" "extract_thumbnail" {
  name = "FFmpegExtractThumbnail"

  input_parameter {
    name = "inputFile"
    type = "Locator"
  }

  input_parameter {
    name     = "position"
    type     = "number | string"
    optional = true
  }

  input_parameter {
    name     = "width"
    type     = "number"
    optional = true
  }

  input_parameter {
    name     = "height"
    type     = "number"
    optional = true
  }

  input_parameter {
    name     = "aspectRatio"
    type     = "number | string"
    optional = true
  }

  input_parameter {
    name     = "autoPadding"
    type     = "boolean"
    optional = true
  }

  output_parameter {
    name = "outputFile"
    type = "S3Locator"
  }
}

resource "mcma_job_profile" "transcode" {
  name = "FFmpegTranscode"

  input_parameter {
    name = "inputFile"
    type = "Locator"
  }

  input_parameter {
    name     = "format"
    type     = "string"
    optional = true
  }

  input_parameter {
    name     = "videoCodec"
    type     = "string"
    optional = true
  }

  input_parameter {
    name     = "audioCodec"
    type     = "string"
    optional = true
  }

  input_parameter {
    name     = "videoBitRate"
    type     = "number"
    optional = true
  }

  input_parameter {
    name     = "audioBitRate"
    type     = "number"
    optional = true
  }

  input_parameter {
    name     = "width"
    type     = "number"
    optional = true
  }

  input_parameter {
    name     = "height"
    type     = "number"
    optional = true
  }

  input_parameter {
    name     = "aspectRatio"
    type     = "number | string"
    optional = true
  }

  input_parameter {
    name     = "autoPadding"
    type     = "boolean"
    optional = true
  }

  output_parameter {
    name = "outputFile"
    type = "S3Locator"
  }
}
