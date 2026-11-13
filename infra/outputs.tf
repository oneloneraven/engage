output "app_dnssec_ds_record" {
  description = "DS record to add at the domain registrar once DNSSEC is active."
  value       = cloudflare_zone_dnssec.app.ds
}
