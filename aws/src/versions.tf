terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 4.22"
    }
    mcma = {
      source  = "ebu/mcma"
      version = ">= 0.0.23"
    }
  }
}
