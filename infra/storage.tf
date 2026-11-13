resource "cloudflare_d1_database" "engage" {
  account_id = var.cloudflare_account_id
  name       = "engage"

  # The provider rejects an update without this block.
  read_replication = {
    mode = "disabled"
  }

  # A deleted D1 database can't be restored, so any plan that would replace it must fail.
  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_r2_bucket" "attachments" {
  account_id = var.cloudflare_account_id
  name       = "engage-attachments"

  lifecycle {
    prevent_destroy = true
  }
}
