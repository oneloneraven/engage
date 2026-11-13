terraform {
  required_version = ">= 1.10.0"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }

  # The endpoint is passed at init: -backend-config="endpoints={s3=\"https://<account id>.r2.cloudflarestorage.com\"}"
  backend "s3" {
    bucket                      = "engage-tfstate"
    key                         = "engage/terraform.tfstate"
    region                      = "auto"
    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_s3_checksum            = true
    use_path_style              = true
  }
}

provider "cloudflare" {}

data "cloudflare_zone" "app" {
  filter = {
    name = var.app_zone_name
  }
}
