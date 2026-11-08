export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      access_audit: {
        Row: {
          actor_id: string
          actor_role: string
          at: string
          binding_generation: number | null
          binding_id: string | null
          channel: string
          id: number
          member_id: string | null
          object_id: string | null
          session_id: string | null
          surface: string
        }
        Insert: {
          actor_id: string
          actor_role: string
          at?: string
          binding_generation?: number | null
          binding_id?: string | null
          channel?: string
          id?: never
          member_id?: string | null
          object_id?: string | null
          session_id?: string | null
          surface: string
        }
        Update: {
          actor_id?: string
          actor_role?: string
          at?: string
          binding_generation?: number | null
          binding_id?: string | null
          channel?: string
          id?: never
          member_id?: string | null
          object_id?: string | null
          session_id?: string | null
          surface?: string
        }
        Relationships: [
          {
            foreignKeyName: "access_audit_binding_id_fkey"
            columns: ["binding_id"]
            isOneToOne: false
            referencedRelation: "telegram_auth_bindings"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_oversight_settings: {
        Row: {
          admin_conversation_read_enabled: boolean
          singleton: boolean
          updated_at: string
        }
        Insert: {
          admin_conversation_read_enabled?: boolean
          singleton?: boolean
          updated_at?: string
        }
        Update: {
          admin_conversation_read_enabled?: boolean
          singleton?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      ai_plan_capabilities: {
        Row: {
          enabled: boolean
          singleton: boolean
        }
        Insert: {
          enabled?: boolean
          singleton?: boolean
        }
        Update: {
          enabled?: boolean
          singleton?: boolean
        }
        Relationships: []
      }
      ai_plan_generations: {
        Row: {
          adopted_at: string | null
          adopted_by: string | null
          adopted_fields: string[] | null
          builder_version: string
          case_revision: number
          cost_usd: number | null
          created_at: string
          doctor_id: string
          draft: Json | null
          estimate_usd: number
          evidence_token: string
          fallback_used: boolean
          finished_at: string | null
          guard: string[]
          id: string
          input_sha256: string
          input_tokens: number | null
          items: Json | null
          lab_token: string
          language: string
          latency_ms: number | null
          local: boolean
          mode: string | null
          model: string
          outcome: string | null
          output_tokens: number | null
          prompt_version: string
          provider: string | null
          refusal: string | null
          reserved: boolean
          response_model: string | null
          spend_day: string
          state: string
          summary: string | null
          tier: string
          user_id: string
        }
        Insert: {
          adopted_at?: string | null
          adopted_by?: string | null
          adopted_fields?: string[] | null
          builder_version: string
          case_revision: number
          cost_usd?: number | null
          created_at?: string
          doctor_id: string
          draft?: Json | null
          estimate_usd: number
          evidence_token: string
          fallback_used?: boolean
          finished_at?: string | null
          guard?: string[]
          id?: string
          input_sha256: string
          input_tokens?: number | null
          items?: Json | null
          lab_token: string
          language: string
          latency_ms?: number | null
          local: boolean
          mode?: string | null
          model: string
          outcome?: string | null
          output_tokens?: number | null
          prompt_version: string
          provider?: string | null
          refusal?: string | null
          reserved: boolean
          response_model?: string | null
          spend_day: string
          state: string
          summary?: string | null
          tier: string
          user_id: string
        }
        Update: {
          adopted_at?: string | null
          adopted_by?: string | null
          adopted_fields?: string[] | null
          builder_version?: string
          case_revision?: number
          cost_usd?: number | null
          created_at?: string
          doctor_id?: string
          draft?: Json | null
          estimate_usd?: number
          evidence_token?: string
          fallback_used?: boolean
          finished_at?: string | null
          guard?: string[]
          id?: string
          input_sha256?: string
          input_tokens?: number | null
          items?: Json | null
          lab_token?: string
          language?: string
          latency_ms?: number | null
          local?: boolean
          mode?: string | null
          model?: string
          outcome?: string | null
          output_tokens?: number | null
          prompt_version?: string
          provider?: string | null
          refusal?: string | null
          reserved?: boolean
          response_model?: string | null
          spend_day?: string
          state?: string
          summary?: string | null
          tier?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_plan_generations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "patient_clinical_cases"
            referencedColumns: ["user_id"]
          },
        ]
      }
      auth_admissions: {
        Row: {
          auth_user_id: string
          binding_generation: number
          binding_id: string
          created_at: string
          decided_at: string | null
          expires_at: string | null
          id: string
          nonce_hmac: string | null
          operation_generation: number | null
          operation_id: string
          operation_kind: string
          session_id: string | null
          state: string
        }
        Insert: {
          auth_user_id: string
          binding_generation: number
          binding_id: string
          created_at?: string
          decided_at?: string | null
          expires_at?: string | null
          id?: string
          nonce_hmac?: string | null
          operation_generation?: number | null
          operation_id: string
          operation_kind: string
          session_id?: string | null
          state: string
        }
        Update: {
          auth_user_id?: string
          binding_generation?: number
          binding_id?: string
          created_at?: string
          decided_at?: string | null
          expires_at?: string | null
          id?: string
          nonce_hmac?: string | null
          operation_generation?: number | null
          operation_id?: string
          operation_kind?: string
          session_id?: string | null
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "auth_admissions_binding_id_fkey"
            columns: ["binding_id"]
            isOneToOne: false
            referencedRelation: "telegram_auth_bindings"
            referencedColumns: ["id"]
          },
        ]
      }
      auth_cleanup_jobs: {
        Row: {
          attempts: number
          auth_user_id: string
          deleted_sessions: number | null
          done_at: string | null
          due_at: string
          id: string
          revoked_at: string
          state: string
        }
        Insert: {
          attempts?: number
          auth_user_id: string
          deleted_sessions?: number | null
          done_at?: string | null
          due_at: string
          id?: string
          revoked_at: string
          state?: string
        }
        Update: {
          attempts?: number
          auth_user_id?: string
          deleted_sessions?: number | null
          done_at?: string | null
          due_at?: string
          id?: string
          revoked_at?: string
          state?: string
        }
        Relationships: []
      }
      auth_code_requests: {
        Row: {
          address: string | null
          binding_generation: number | null
          binding_id: string | null
          body_hmac: string | null
          channel: string
          code_digest: string | null
          code_sealed: string | null
          created_at: string
          failed_checks: number
          id: string
          last_failed_at: string | null
          lease_until: string
          nonce_hmac: string
          phone: string
          proof_id: string | null
          proof_links: number
          refusal: string | null
          signin_link_id: string | null
          state: string
          updated_at: string
          verified_result: Json | null
          verified_session: string | null
          verified_user: string | null
          webhook_id: string | null
        }
        Insert: {
          address?: string | null
          binding_generation?: number | null
          binding_id?: string | null
          body_hmac?: string | null
          channel?: string
          code_digest?: string | null
          code_sealed?: string | null
          created_at?: string
          failed_checks?: number
          id?: string
          last_failed_at?: string | null
          lease_until: string
          nonce_hmac: string
          phone: string
          proof_id?: string | null
          proof_links?: number
          refusal?: string | null
          signin_link_id?: string | null
          state?: string
          updated_at?: string
          verified_result?: Json | null
          verified_session?: string | null
          verified_user?: string | null
          webhook_id?: string | null
        }
        Update: {
          address?: string | null
          binding_generation?: number | null
          binding_id?: string | null
          body_hmac?: string | null
          channel?: string
          code_digest?: string | null
          code_sealed?: string | null
          created_at?: string
          failed_checks?: number
          id?: string
          last_failed_at?: string | null
          lease_until?: string
          nonce_hmac?: string
          phone?: string
          proof_id?: string | null
          proof_links?: number
          refusal?: string | null
          signin_link_id?: string | null
          state?: string
          updated_at?: string
          verified_result?: Json | null
          verified_session?: string | null
          verified_user?: string | null
          webhook_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "auth_code_requests_binding_id_fkey"
            columns: ["binding_id"]
            isOneToOne: false
            referencedRelation: "telegram_auth_bindings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auth_code_requests_proof_id_fkey"
            columns: ["proof_id"]
            isOneToOne: false
            referencedRelation: "telegram_phone_proofs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auth_code_requests_signin_link_id_fkey"
            columns: ["signin_link_id"]
            isOneToOne: false
            referencedRelation: "telegram_signin_links"
            referencedColumns: ["id"]
          },
        ]
      }
      auth_sms_hook_attempts: {
        Row: {
          amount_micros: number
          body_digest: string
          budget_day: string
          channel: string
          claim_token: string
          created_at: string
          currency: string
          finished_at: string | null
          policy_revision: number
          provider: string
          provider_reference: string | null
          status: string
          verification_digest: string | null
          webhook_id: string
        }
        Insert: {
          amount_micros: number
          body_digest: string
          budget_day: string
          channel?: string
          claim_token?: string
          created_at?: string
          currency: string
          finished_at?: string | null
          policy_revision: number
          provider?: string
          provider_reference?: string | null
          status?: string
          verification_digest?: string | null
          webhook_id: string
        }
        Update: {
          amount_micros?: number
          body_digest?: string
          budget_day?: string
          channel?: string
          claim_token?: string
          created_at?: string
          currency?: string
          finished_at?: string | null
          policy_revision?: number
          provider?: string
          provider_reference?: string | null
          status?: string
          verification_digest?: string | null
          webhook_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "auth_sms_hook_attempts_budget_day_currency_fkey"
            columns: ["budget_day", "currency"]
            isOneToOne: false
            referencedRelation: "patient_message_spend_totals"
            referencedColumns: ["budget_day", "currency"]
          },
          {
            foreignKeyName: "auth_sms_hook_attempts_policy_revision_fkey"
            columns: ["policy_revision"]
            isOneToOne: false
            referencedRelation: "patient_message_spend_policy_events"
            referencedColumns: ["revision"]
          },
        ]
      }
      auth_verify_attempt_bindings: {
        Row: {
          previous_reference: string | null
          recipient_digest: string
          webhook_id: string
        }
        Insert: {
          previous_reference?: string | null
          recipient_digest: string
          webhook_id: string
        }
        Update: {
          previous_reference?: string | null
          recipient_digest?: string
          webhook_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "auth_verify_attempt_bindings_recipient_digest_fkey"
            columns: ["recipient_digest"]
            isOneToOne: false
            referencedRelation: "auth_verify_recipients"
            referencedColumns: ["recipient_digest"]
          },
          {
            foreignKeyName: "auth_verify_attempt_bindings_webhook_id_fkey"
            columns: ["webhook_id"]
            isOneToOne: true
            referencedRelation: "auth_sms_hook_attempts"
            referencedColumns: ["webhook_id"]
          },
        ]
      }
      auth_verify_feedback: {
        Row: {
          claim_token: string
          created_at: string
          finished_at: string | null
          provider_reference: string
          status: string
          webhook_id: string
        }
        Insert: {
          claim_token?: string
          created_at?: string
          finished_at?: string | null
          provider_reference: string
          status?: string
          webhook_id: string
        }
        Update: {
          claim_token?: string
          created_at?: string
          finished_at?: string | null
          provider_reference?: string
          status?: string
          webhook_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "auth_verify_feedback_webhook_id_fkey"
            columns: ["webhook_id"]
            isOneToOne: true
            referencedRelation: "auth_sms_hook_attempts"
            referencedColumns: ["webhook_id"]
          },
        ]
      }
      auth_verify_recipients: {
        Row: {
          active_webhook_id: string | null
          recipient_digest: string
        }
        Insert: {
          active_webhook_id?: string | null
          recipient_digest: string
        }
        Update: {
          active_webhook_id?: string | null
          recipient_digest?: string
        }
        Relationships: [
          {
            foreignKeyName: "auth_verify_recipients_active_webhook_id_fkey"
            columns: ["active_webhook_id"]
            isOneToOne: false
            referencedRelation: "auth_sms_hook_attempts"
            referencedColumns: ["webhook_id"]
          },
        ]
      }
      auth_verify_recovery_events: {
        Row: {
          control_revision: number
          created_at: string
          operator_label: string
          recipient_digest: string
          webhook_id: string
        }
        Insert: {
          control_revision: number
          created_at?: string
          operator_label: string
          recipient_digest: string
          webhook_id: string
        }
        Update: {
          control_revision?: number
          created_at?: string
          operator_label?: string
          recipient_digest?: string
          webhook_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "auth_verify_recovery_events_recipient_digest_fkey"
            columns: ["recipient_digest"]
            isOneToOne: false
            referencedRelation: "auth_verify_recipients"
            referencedColumns: ["recipient_digest"]
          },
          {
            foreignKeyName: "auth_verify_recovery_events_webhook_id_fkey"
            columns: ["webhook_id"]
            isOneToOne: true
            referencedRelation: "auth_sms_hook_attempts"
            referencedColumns: ["webhook_id"]
          },
        ]
      }
      booking_appointment_commands: {
        Row: {
          actor_id: string
          created_at: string
          id: string
          input: Json
          member_id: string
          result: Json
        }
        Insert: {
          actor_id: string
          created_at?: string
          id: string
          input: Json
          member_id: string
          result: Json
        }
        Update: {
          actor_id?: string
          created_at?: string
          id?: string
          input?: Json
          member_id?: string
          result?: Json
        }
        Relationships: []
      }
      booking_appointment_events: {
        Row: {
          actor_id: string | null
          appointment_id: string
          attempt_id: string | null
          created_at: string
          id: string
          kind: string
          notice_id: string
          operation_input: Json | null
          operation_result: Json | null
          revision: number
        }
        Insert: {
          actor_id?: string | null
          appointment_id: string
          attempt_id?: string | null
          created_at?: string
          id?: string
          kind: string
          notice_id: string
          operation_input?: Json | null
          operation_result?: Json | null
          revision: number
        }
        Update: {
          actor_id?: string | null
          appointment_id?: string
          attempt_id?: string | null
          created_at?: string
          id?: string
          kind?: string
          notice_id?: string
          operation_input?: Json | null
          operation_result?: Json | null
          revision?: number
        }
        Relationships: [
          {
            foreignKeyName: "booking_appointment_events_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "booking_appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_appointment_events_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "booking_notice_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_appointment_events_notice_id_fkey"
            columns: ["notice_id"]
            isOneToOne: false
            referencedRelation: "booking_scheduling_notices"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_appointment_versions: {
        Row: {
          actor_id: string
          agreement_source: string | null
          appointment_id: string
          created_at: string
          legacy_snapshot: Json | null
          notice_id: string
          previous_arrangement: Json | null
          previous_program: Json | null
          program_id: string
          proposed_arrangement: Json
          revision: number
        }
        Insert: {
          actor_id: string
          agreement_source?: string | null
          appointment_id: string
          created_at?: string
          legacy_snapshot?: Json | null
          notice_id: string
          previous_arrangement?: Json | null
          previous_program?: Json | null
          program_id: string
          proposed_arrangement: Json
          revision: number
        }
        Update: {
          actor_id?: string
          agreement_source?: string | null
          appointment_id?: string
          created_at?: string
          legacy_snapshot?: Json | null
          notice_id?: string
          previous_arrangement?: Json | null
          previous_program?: Json | null
          program_id?: string
          proposed_arrangement?: Json
          revision?: number
        }
        Relationships: [
          {
            foreignKeyName: "booking_appointment_versions_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "booking_appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_appointment_versions_notice_id_fkey"
            columns: ["notice_id"]
            isOneToOne: true
            referencedRelation: "booking_scheduling_notices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_appointment_versions_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "booking_program_seals"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_appointments: {
        Row: {
          created_at: string
          current_arrangement: Json | null
          current_program: Json | null
          current_reservation_id: string | null
          id: string
          legacy_current: Json | null
          member_id: string
          notice_id: string
          program_id: string
          proposed_arrangement: Json
          proposed_reservation_id: string
          requirements_token: string
          revision: number
          status: string
        }
        Insert: {
          created_at?: string
          current_arrangement?: Json | null
          current_program?: Json | null
          current_reservation_id?: string | null
          id: string
          legacy_current?: Json | null
          member_id: string
          notice_id: string
          program_id: string
          proposed_arrangement: Json
          proposed_reservation_id: string
          requirements_token: string
          revision?: number
          status: string
        }
        Update: {
          created_at?: string
          current_arrangement?: Json | null
          current_program?: Json | null
          current_reservation_id?: string | null
          id?: string
          legacy_current?: Json | null
          member_id?: string
          notice_id?: string
          program_id?: string
          proposed_arrangement?: Json
          proposed_reservation_id?: string
          requirements_token?: string
          revision?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_appointments_current_reservation_id_fkey"
            columns: ["current_reservation_id"]
            isOneToOne: false
            referencedRelation: "booking_manual_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_appointments_notice_id_fkey"
            columns: ["notice_id"]
            isOneToOne: false
            referencedRelation: "booking_scheduling_notices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_appointments_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "booking_program_seals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_appointments_proposed_reservation_id_fkey"
            columns: ["proposed_reservation_id"]
            isOneToOne: false
            referencedRelation: "booking_manual_reservations"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_legacy_conversions: {
        Row: {
          actor_id: string
          agreement_source: string
          appointment_id: string
          created_at: string
          legacy_id: string
        }
        Insert: {
          actor_id: string
          agreement_source: string
          appointment_id: string
          created_at?: string
          legacy_id: string
        }
        Update: {
          actor_id?: string
          agreement_source?: string
          appointment_id?: string
          created_at?: string
          legacy_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_legacy_conversions_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: true
            referencedRelation: "booking_appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_legacy_conversions_legacy_id_fkey"
            columns: ["legacy_id"]
            isOneToOne: true
            referencedRelation: "patient_test_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_manual_capacity: {
        Row: {
          capacity: number
          clinic_id: string
          created_at: string
          created_by: string
          ends_at: string
          key: string
          reference: string
          source: string
          starts_at: string
          valid_until: string
        }
        Insert: {
          capacity: number
          clinic_id: string
          created_at?: string
          created_by: string
          ends_at: string
          key: string
          reference: string
          source: string
          starts_at: string
          valid_until: string
        }
        Update: {
          capacity?: number
          clinic_id?: string
          created_at?: string
          created_by?: string
          ends_at?: string
          key?: string
          reference?: string
          source?: string
          starts_at?: string
          valid_until?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_manual_capacity_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "workspace_clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_manual_reservations: {
        Row: {
          appointment_id: string
          capacity_key: string
          created_at: string
          id: string
          member_id: string
          offer_id: string
          offer_version: string
          state: string
          valid_until: string
        }
        Insert: {
          appointment_id: string
          capacity_key: string
          created_at?: string
          id: string
          member_id: string
          offer_id: string
          offer_version: string
          state?: string
          valid_until: string
        }
        Update: {
          appointment_id?: string
          capacity_key?: string
          created_at?: string
          id?: string
          member_id?: string
          offer_id?: string
          offer_version?: string
          state?: string
          valid_until?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_manual_reservations_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "booking_appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_manual_reservations_capacity_key_fkey"
            columns: ["capacity_key"]
            isOneToOne: false
            referencedRelation: "booking_manual_capacity"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "booking_manual_reservations_offer_id_offer_version_fkey"
            columns: ["offer_id", "offer_version"]
            isOneToOne: false
            referencedRelation: "booking_offer_snapshots"
            referencedColumns: ["id", "version"]
          },
        ]
      }
      booking_notice_attempts: {
        Row: {
          applied_at: string | null
          created_at: string
          envelope_hash: string
          generation: number
          id: string
          notice_id: string
          receipt: Json | null
        }
        Insert: {
          applied_at?: string | null
          created_at?: string
          envelope_hash: string
          generation: number
          id: string
          notice_id: string
          receipt?: Json | null
        }
        Update: {
          applied_at?: string | null
          created_at?: string
          envelope_hash?: string
          generation?: number
          id?: string
          notice_id?: string
          receipt?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_notice_attempts_notice_id_fkey"
            columns: ["notice_id"]
            isOneToOne: false
            referencedRelation: "booking_scheduling_notices"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_notice_first_send_commands: {
        Row: {
          actor_id: string
          attempt_id: string | null
          created_at: string
          id: string
          input: Json
          member_id: string
          notice_id: string
        }
        Insert: {
          actor_id: string
          attempt_id?: string | null
          created_at?: string
          id: string
          input: Json
          member_id: string
          notice_id: string
        }
        Update: {
          actor_id?: string
          attempt_id?: string | null
          created_at?: string
          id?: string
          input?: Json
          member_id?: string
          notice_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_notice_first_send_commands_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: true
            referencedRelation: "booking_notice_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_notice_first_send_commands_notice_id_fkey"
            columns: ["notice_id"]
            isOneToOne: false
            referencedRelation: "booking_scheduling_notices"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_notice_retry_commands: {
        Row: {
          actor_id: string
          attempt_id: string | null
          created_at: string
          id: string
          input: Json
          member_id: string
          notice_id: string
        }
        Insert: {
          actor_id: string
          attempt_id?: string | null
          created_at?: string
          id: string
          input: Json
          member_id: string
          notice_id: string
        }
        Update: {
          actor_id?: string
          attempt_id?: string | null
          created_at?: string
          id?: string
          input?: Json
          member_id?: string
          notice_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_notice_retry_commands_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: true
            referencedRelation: "booking_notice_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_notice_retry_commands_notice_id_fkey"
            columns: ["notice_id"]
            isOneToOne: false
            referencedRelation: "booking_scheduling_notices"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_offer_snapshots: {
        Row: {
          capacity_key: string
          created_at: string
          created_by: string
          id: string
          offer: Json
          superseded_at: string | null
          version: string
        }
        Insert: {
          capacity_key: string
          created_at?: string
          created_by: string
          id: string
          offer: Json
          superseded_at?: string | null
          version: string
        }
        Update: {
          capacity_key?: string
          created_at?: string
          created_by?: string
          id?: string
          offer?: Json
          superseded_at?: string | null
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_offer_snapshots_capacity_key_fkey"
            columns: ["capacity_key"]
            isOneToOne: false
            referencedRelation: "booking_manual_capacity"
            referencedColumns: ["key"]
          },
        ]
      }
      booking_program_seals: {
        Row: {
          actor_id: string
          created_at: string
          engine_version: string
          id: string
          member_id: string
          program: Json
          requirements_token: string
          source_token: string
        }
        Insert: {
          actor_id: string
          created_at?: string
          engine_version: string
          id: string
          member_id: string
          program: Json
          requirements_token: string
          source_token: string
        }
        Update: {
          actor_id?: string
          created_at?: string
          engine_version?: string
          id?: string
          member_id?: string
          program?: Json
          requirements_token?: string
          source_token?: string
        }
        Relationships: []
      }
      booking_scheduling_notices: {
        Row: {
          appointment_id: string
          appointment_revision: number
          channel: string
          clinic_email: string | null
          clinic_id: string
          clinic_revision: number
          copy_email: string | null
          copy_revision: number | null
          created_at: string
          envelope_hash: string | null
          generation: number
          id: string
          lease_until: string | null
          program_id: string
          purpose: string
          reservation_id: string
          sender_email: string | null
          state: string
          subject: string | null
          template_version: string | null
          text_content: string | null
        }
        Insert: {
          appointment_id: string
          appointment_revision: number
          channel?: string
          clinic_email?: string | null
          clinic_id: string
          clinic_revision: number
          copy_email?: string | null
          copy_revision?: number | null
          created_at?: string
          envelope_hash?: string | null
          generation?: number
          id: string
          lease_until?: string | null
          program_id: string
          purpose?: string
          reservation_id: string
          sender_email?: string | null
          state?: string
          subject?: string | null
          template_version?: string | null
          text_content?: string | null
        }
        Update: {
          appointment_id?: string
          appointment_revision?: number
          channel?: string
          clinic_email?: string | null
          clinic_id?: string
          clinic_revision?: number
          copy_email?: string | null
          copy_revision?: number | null
          created_at?: string
          envelope_hash?: string | null
          generation?: number
          id?: string
          lease_until?: string | null
          program_id?: string
          purpose?: string
          reservation_id?: string
          sender_email?: string | null
          state?: string
          subject?: string | null
          template_version?: string | null
          text_content?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_scheduling_notices_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "booking_appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_scheduling_notices_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "workspace_clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_scheduling_notices_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "booking_program_seals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_scheduling_notices_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "booking_manual_reservations"
            referencedColumns: ["id"]
          },
        ]
      }
      bp_check_retries: {
        Row: {
          attempts: number
          created_at: string
          level: string
          measured_at: string
          member_id: string
          ref: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          level: string
          measured_at: string
          member_id: string
          ref: string
        }
        Update: {
          attempts?: number
          created_at?: string
          level?: string
          measured_at?: string
          member_id?: string
          ref?: string
        }
        Relationships: []
      }
      bp_device_assignments: {
        Row: {
          assign_reason: string | null
          assigned_at: string
          assigned_by: string
          assigned_by_name: string
          assigned_by_role: string
          device_id: string
          end_reason: string | null
          ended_at: string | null
          ended_by: string | null
          ended_by_name: string | null
          ended_by_role: string | null
          ended_recorded_at: string | null
          id: string
          member_id: string
          recorded_at: string
        }
        Insert: {
          assign_reason?: string | null
          assigned_at: string
          assigned_by: string
          assigned_by_name: string
          assigned_by_role: string
          device_id: string
          end_reason?: string | null
          ended_at?: string | null
          ended_by?: string | null
          ended_by_name?: string | null
          ended_by_role?: string | null
          ended_recorded_at?: string | null
          id?: string
          member_id: string
          recorded_at?: string
        }
        Update: {
          assign_reason?: string | null
          assigned_at?: string
          assigned_by?: string
          assigned_by_name?: string
          assigned_by_role?: string
          device_id?: string
          end_reason?: string | null
          ended_at?: string | null
          ended_by?: string | null
          ended_by_name?: string | null
          ended_by_role?: string | null
          ended_recorded_at?: string | null
          id?: string
          member_id?: string
          recorded_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bp_device_assignments_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "bp_devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bp_device_assignments_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "patient_clinical_cases"
            referencedColumns: ["user_id"]
          },
        ]
      }
      bp_device_commands: {
        Row: {
          actor_id: string
          created_at: string
          payload: Json
          result: Json
          submission_id: string
        }
        Insert: {
          actor_id: string
          created_at?: string
          payload: Json
          result: Json
          submission_id: string
        }
        Update: {
          actor_id?: string
          created_at?: string
          payload?: Json
          result?: Json
          submission_id?: string
        }
        Relationships: []
      }
      bp_device_events: {
        Row: {
          actor_id: string
          actor_name: string
          actor_role: string
          at: string
          detail: Json
          device_id: string
          id: string
          kind: string
          reason: string | null
        }
        Insert: {
          actor_id: string
          actor_name: string
          actor_role: string
          at?: string
          detail?: Json
          device_id: string
          id?: string
          kind: string
          reason?: string | null
        }
        Update: {
          actor_id?: string
          actor_name?: string
          actor_role?: string
          at?: string
          detail?: Json
          device_id?: string
          id?: string
          kind?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bp_device_events_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "bp_devices"
            referencedColumns: ["id"]
          },
        ]
      }
      bp_device_readings: {
        Row: {
          assignment_id: string | null
          claimed_member_id: string | null
          device_id: string | null
          diastolic: number
          external_id: string
          hold_reason: string | null
          id: string
          measured_at: string
          member_id: string | null
          pulse: number | null
          received_at: string
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          serial: string
          state: string
          systolic: number
          transport: string
        }
        Insert: {
          assignment_id?: string | null
          claimed_member_id?: string | null
          device_id?: string | null
          diastolic: number
          external_id: string
          hold_reason?: string | null
          id?: string
          measured_at: string
          member_id?: string | null
          pulse?: number | null
          received_at?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          serial: string
          state: string
          systolic: number
          transport: string
        }
        Update: {
          assignment_id?: string | null
          claimed_member_id?: string | null
          device_id?: string | null
          diastolic?: number
          external_id?: string
          hold_reason?: string | null
          id?: string
          measured_at?: string
          member_id?: string | null
          pulse?: number | null
          received_at?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          serial?: string
          state?: string
          systolic?: number
          transport?: string
        }
        Relationships: [
          {
            foreignKeyName: "bp_device_readings_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "bp_device_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bp_device_readings_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "bp_devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bp_device_readings_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "patient_clinical_cases"
            referencedColumns: ["user_id"]
          },
        ]
      }
      bp_devices: {
        Row: {
          created_at: string
          created_by: string
          id: string
          model: string
          revision: number
          serial: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          model: string
          revision?: number
          serial: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          model?: string
          revision?: number
          serial?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      bp_repeat_notes: {
        Row: {
          closed_at: string | null
          created_at: string
          diastolic: number
          id: string
          measured_at: string
          measurement_id: string
          member_id: string
          merged_into_alert_id: string | null
          merged_into_task_id: string | null
          systolic: number
        }
        Insert: {
          closed_at?: string | null
          created_at?: string
          diastolic: number
          id?: string
          measured_at: string
          measurement_id: string
          member_id: string
          merged_into_alert_id?: string | null
          merged_into_task_id?: string | null
          systolic: number
        }
        Update: {
          closed_at?: string | null
          created_at?: string
          diastolic?: number
          id?: string
          measured_at?: string
          measurement_id?: string
          member_id?: string
          merged_into_alert_id?: string | null
          merged_into_task_id?: string | null
          systolic?: number
        }
        Relationships: [
          {
            foreignKeyName: "bp_repeat_notes_measurement_id_fkey"
            columns: ["measurement_id"]
            isOneToOne: false
            referencedRelation: "patient_measurements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bp_repeat_notes_merged_into_alert_id_fkey"
            columns: ["merged_into_alert_id"]
            isOneToOne: false
            referencedRelation: "care_alerts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bp_repeat_notes_merged_into_task_id_fkey"
            columns: ["merged_into_task_id"]
            isOneToOne: false
            referencedRelation: "care_queue_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      bp_week_readings: {
        Row: {
          created_at: string
          day: number
          measurement_id: string
          member_id: string
          slot: string
          week_id: string
        }
        Insert: {
          created_at?: string
          day: number
          measurement_id: string
          member_id: string
          slot: string
          week_id: string
        }
        Update: {
          created_at?: string
          day?: number
          measurement_id?: string
          member_id?: string
          slot?: string
          week_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bp_week_readings_measurement_id_fkey"
            columns: ["measurement_id"]
            isOneToOne: true
            referencedRelation: "patient_measurements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bp_week_readings_week_id_fkey"
            columns: ["week_id"]
            isOneToOne: false
            referencedRelation: "bp_weeks"
            referencedColumns: ["id"]
          },
        ]
      }
      bp_week_settings: {
        Row: {
          enabled: boolean
          member_can_start: boolean
          reminders: boolean
          singleton: boolean
          updated_at: string
        }
        Insert: {
          enabled?: boolean
          member_can_start?: boolean
          reminders?: boolean
          singleton?: boolean
          updated_at?: string
        }
        Update: {
          enabled?: boolean
          member_can_start?: boolean
          reminders?: boolean
          singleton?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      bp_weekly_summary_settings: {
        Row: {
          enabled: boolean
          last_run_at: string | null
          singleton: boolean
          updated_at: string
        }
        Insert: {
          enabled?: boolean
          last_run_at?: string | null
          singleton?: boolean
          updated_at?: string
        }
        Update: {
          enabled?: boolean
          last_run_at?: string | null
          singleton?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      bp_weekly_trends: {
        Row: {
          created_at: string
          days_measured: number
          member_id: string
          previous_mean_dia: number | null
          previous_mean_sys: number | null
          readings_previous: number
          readings_this: number
          this_mean_dia: number
          this_mean_sys: number
          trend: string
          week_start: string
        }
        Insert: {
          created_at?: string
          days_measured: number
          member_id: string
          previous_mean_dia?: number | null
          previous_mean_sys?: number | null
          readings_previous: number
          readings_this: number
          this_mean_dia: number
          this_mean_sys: number
          trend: string
          week_start: string
        }
        Update: {
          created_at?: string
          days_measured?: number
          member_id?: string
          previous_mean_dia?: number | null
          previous_mean_sys?: number | null
          readings_previous?: number
          readings_this?: number
          this_mean_dia?: number
          this_mean_sys?: number
          trend?: string
          week_start?: string
        }
        Relationships: []
      }
      bp_weeks: {
        Row: {
          created_at: string
          days: number
          device_assignment_id: string | null
          evening_time: string
          id: string
          member_id: string
          morning_time: string
          readings_per_slot: number
          reminders: boolean
          started_by: string
          started_by_role: string
          starts_on: string
          stop_reason: string | null
          stopped_at: string | null
          stopped_by: string | null
        }
        Insert: {
          created_at?: string
          days?: number
          device_assignment_id?: string | null
          evening_time?: string
          id?: string
          member_id: string
          morning_time?: string
          readings_per_slot?: number
          reminders?: boolean
          started_by: string
          started_by_role: string
          starts_on: string
          stop_reason?: string | null
          stopped_at?: string | null
          stopped_by?: string | null
        }
        Update: {
          created_at?: string
          days?: number
          device_assignment_id?: string | null
          evening_time?: string
          id?: string
          member_id?: string
          morning_time?: string
          readings_per_slot?: number
          reminders?: boolean
          started_by?: string
          started_by_role?: string
          starts_on?: string
          stop_reason?: string | null
          stopped_at?: string | null
          stopped_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bp_weeks_device_assignment_id_fkey"
            columns: ["device_assignment_id"]
            isOneToOne: false
            referencedRelation: "bp_device_assignments"
            referencedColumns: ["id"]
          },
        ]
      }
      care_alert_audit: {
        Row: {
          actor_id: string | null
          alert_id: string
          created_at: string
          detail: Json
          id: number
          kind: string
        }
        Insert: {
          actor_id?: string | null
          alert_id: string
          created_at?: string
          detail?: Json
          id?: never
          kind: string
        }
        Update: {
          actor_id?: string | null
          alert_id?: string
          created_at?: string
          detail?: Json
          id?: never
          kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "care_alert_audit_alert_id_fkey"
            columns: ["alert_id"]
            isOneToOne: false
            referencedRelation: "care_alerts"
            referencedColumns: ["id"]
          },
        ]
      }
      care_alert_deliveries: {
        Row: {
          alert_id: string
          channel: string
          created_at: string
          id: string
          occurrence: number
          recipient_id: string
          telegram_message_id: string | null
        }
        Insert: {
          alert_id: string
          channel: string
          created_at?: string
          id?: string
          occurrence: number
          recipient_id: string
          telegram_message_id?: string | null
        }
        Update: {
          alert_id?: string
          channel?: string
          created_at?: string
          id?: string
          occurrence?: number
          recipient_id?: string
          telegram_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "care_alert_deliveries_alert_id_fkey"
            columns: ["alert_id"]
            isOneToOne: false
            referencedRelation: "care_alerts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_alert_deliveries_telegram_message_id_fkey"
            columns: ["telegram_message_id"]
            isOneToOne: true
            referencedRelation: "telegram_auth_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      care_alert_routing: {
        Row: {
          backup_role: string | null
          escalate_after_minutes: number | null
          primary_role: string
          source: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          backup_role?: string | null
          escalate_after_minutes?: number | null
          primary_role?: string
          source: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          backup_role?: string | null
          escalate_after_minutes?: number | null
          primary_role?: string
          source?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      care_alert_screenings: {
        Row: {
          alert_id: string | null
          member_id: string
          outcome: string
          reason_code: string
          red_flags: string[]
          rule_id: string
          rule_version: string
          screened_at: string
          source: string
          source_ref: string
        }
        Insert: {
          alert_id?: string | null
          member_id: string
          outcome: string
          reason_code: string
          red_flags?: string[]
          rule_id: string
          rule_version: string
          screened_at?: string
          source: string
          source_ref: string
        }
        Update: {
          alert_id?: string | null
          member_id?: string
          outcome?: string
          reason_code?: string
          red_flags?: string[]
          rule_id?: string
          rule_version?: string
          screened_at?: string
          source?: string
          source_ref?: string
        }
        Relationships: [
          {
            foreignKeyName: "care_alert_screenings_alert_id_fkey"
            columns: ["alert_id"]
            isOneToOne: false
            referencedRelation: "care_alerts"
            referencedColumns: ["id"]
          },
        ]
      }
      care_alert_settings: {
        Row: {
          enabled: boolean
          sandbox_test_accounts: boolean
          singleton: boolean
          telegram_delivery: boolean
          updated_at: string
        }
        Insert: {
          enabled?: boolean
          sandbox_test_accounts?: boolean
          singleton?: boolean
          telegram_delivery?: boolean
          updated_at?: string
        }
        Update: {
          enabled?: boolean
          sandbox_test_accounts?: boolean
          singleton?: boolean
          telegram_delivery?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      care_alerts: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          created_at: string
          cycle_started_at: string
          doctor_id: string | null
          escalated_at: string | null
          escalated_to: string | null
          escalation_attempted_at: string | null
          escalation_notified_at: string | null
          id: string
          last_seen_at: string
          member_id: string
          next_action: string | null
          next_action_at: string | null
          next_action_by: string | null
          next_action_due_at: string | null
          occurrences: number
          priority: string
          reason_code: string
          red_flags: string[]
          resolution: string | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          route_backup: string | null
          route_minutes: number | null
          route_primary: string | null
          rule_id: string
          rule_version: string
          source: string
          source_ref: string
          state: string
          state_seq: number
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          created_at?: string
          cycle_started_at?: string
          doctor_id?: string | null
          escalated_at?: string | null
          escalated_to?: string | null
          escalation_attempted_at?: string | null
          escalation_notified_at?: string | null
          id?: string
          last_seen_at?: string
          member_id: string
          next_action?: string | null
          next_action_at?: string | null
          next_action_by?: string | null
          next_action_due_at?: string | null
          occurrences?: number
          priority?: string
          reason_code: string
          red_flags?: string[]
          resolution?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          route_backup?: string | null
          route_minutes?: number | null
          route_primary?: string | null
          rule_id: string
          rule_version: string
          source: string
          source_ref: string
          state?: string
          state_seq?: number
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          created_at?: string
          cycle_started_at?: string
          doctor_id?: string | null
          escalated_at?: string | null
          escalated_to?: string | null
          escalation_attempted_at?: string | null
          escalation_notified_at?: string | null
          id?: string
          last_seen_at?: string
          member_id?: string
          next_action?: string | null
          next_action_at?: string | null
          next_action_by?: string | null
          next_action_due_at?: string | null
          occurrences?: number
          priority?: string
          reason_code?: string
          red_flags?: string[]
          resolution?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          route_backup?: string | null
          route_minutes?: number | null
          route_primary?: string | null
          rule_id?: string
          rule_version?: string
          source?: string
          source_ref?: string
          state?: string
          state_seq?: number
        }
        Relationships: []
      }
      care_queue_task_events: {
        Row: {
          actor_id: string | null
          at: string
          detail: Json
          from_status: string | null
          id: number
          merged_into_alert_id: string | null
          task_id: string
          to_status: string
        }
        Insert: {
          actor_id?: string | null
          at?: string
          detail?: Json
          from_status?: string | null
          id?: never
          merged_into_alert_id?: string | null
          task_id: string
          to_status: string
        }
        Update: {
          actor_id?: string | null
          at?: string
          detail?: Json
          from_status?: string | null
          id?: never
          merged_into_alert_id?: string | null
          task_id?: string
          to_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "care_queue_task_events_merged_into_alert_id_fkey"
            columns: ["merged_into_alert_id"]
            isOneToOne: false
            referencedRelation: "care_alerts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_queue_task_events_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "care_queue_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      care_queue_tasks: {
        Row: {
          answered_at: string | null
          answered_by: string | null
          closed_at: string | null
          closed_by: string | null
          created_at: string
          id: string
          member_id: string
          merged_into_alert_id: string | null
          queue: string
          reason_code: string
          red_flags_status: string | null
          rule_version: string
          sandbox: boolean
          seen_at: string | null
          seen_by: string | null
          sla_deadline: string | null
          source_ref: string
          state_seq: number
          status: string
          suggested_action: string | null
          summary: Json
          zone: string | null
        }
        Insert: {
          answered_at?: string | null
          answered_by?: string | null
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          id?: string
          member_id: string
          merged_into_alert_id?: string | null
          queue: string
          reason_code: string
          red_flags_status?: string | null
          rule_version: string
          sandbox?: boolean
          seen_at?: string | null
          seen_by?: string | null
          sla_deadline?: string | null
          source_ref: string
          state_seq?: number
          status?: string
          suggested_action?: string | null
          summary?: Json
          zone?: string | null
        }
        Update: {
          answered_at?: string | null
          answered_by?: string | null
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          id?: string
          member_id?: string
          merged_into_alert_id?: string | null
          queue?: string
          reason_code?: string
          red_flags_status?: string | null
          rule_version?: string
          sandbox?: boolean
          seen_at?: string | null
          seen_by?: string | null
          sla_deadline?: string | null
          source_ref?: string
          state_seq?: number
          status?: string
          suggested_action?: string | null
          summary?: Json
          zone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "care_queue_tasks_merged_into_alert_id_fkey"
            columns: ["merged_into_alert_id"]
            isOneToOne: false
            referencedRelation: "care_alerts"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_inbox: {
        Row: {
          adapter: string
          attempts: number
          doctor_telegram_connection: string | null
          doctor_telegram_generation: number | null
          doctor_telegram_response_attempted_at: string | null
          doctor_telegram_route: string | null
          endpoint_generation: number | null
          endpoint_id: string | null
          event_id: string
          fingerprint: string
          id: string
          kind: string
          last_error: string | null
          lease_until: string | null
          nurse_at_commit: boolean
          nurse_binding_generation: number | null
          nurse_binding_id: string | null
          nurse_context: Json | null
          nurse_result: Json | null
          payload: Json
          principal_ref: string | null
          processed_at: string | null
          received_at: string
          result: string | null
          status: string
        }
        Insert: {
          adapter: string
          attempts?: number
          doctor_telegram_connection?: string | null
          doctor_telegram_generation?: number | null
          doctor_telegram_response_attempted_at?: string | null
          doctor_telegram_route?: string | null
          endpoint_generation?: number | null
          endpoint_id?: string | null
          event_id: string
          fingerprint: string
          id?: string
          kind: string
          last_error?: string | null
          lease_until?: string | null
          nurse_at_commit?: boolean
          nurse_binding_generation?: number | null
          nurse_binding_id?: string | null
          nurse_context?: Json | null
          nurse_result?: Json | null
          payload: Json
          principal_ref?: string | null
          processed_at?: string | null
          received_at?: string
          result?: string | null
          status?: string
        }
        Update: {
          adapter?: string
          attempts?: number
          doctor_telegram_connection?: string | null
          doctor_telegram_generation?: number | null
          doctor_telegram_response_attempted_at?: string | null
          doctor_telegram_route?: string | null
          endpoint_generation?: number | null
          endpoint_id?: string | null
          event_id?: string
          fingerprint?: string
          id?: string
          kind?: string
          last_error?: string | null
          lease_until?: string | null
          nurse_at_commit?: boolean
          nurse_binding_generation?: number | null
          nurse_binding_id?: string | null
          nurse_context?: Json | null
          nurse_result?: Json | null
          payload?: Json
          principal_ref?: string | null
          processed_at?: string | null
          received_at?: string
          result?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "channel_inbox_endpoint_id_fkey"
            columns: ["endpoint_id"]
            isOneToOne: false
            referencedRelation: "conversation_endpoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_inbox_nurse_binding_id_fkey"
            columns: ["nurse_binding_id"]
            isOneToOne: false
            referencedRelation: "telegram_auth_bindings"
            referencedColumns: ["id"]
          },
        ]
      }
      cleanup_runs: {
        Row: {
          attempted: number
          cleaned: number
          ended_at: string | null
          failed: number
          failure_category: string | null
          job_kind: string
          run_id: string
          started_at: string
          status: string
        }
        Insert: {
          attempted?: number
          cleaned?: number
          ended_at?: string | null
          failed?: number
          failure_category?: string | null
          job_kind?: string
          run_id: string
          started_at?: string
          status?: string
        }
        Update: {
          attempted?: number
          cleaned?: number
          ended_at?: string | null
          failed?: number
          failure_category?: string | null
          job_kind?: string
          run_id?: string
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      clinic_admin_change_requests: {
        Row: {
          before: Json
          clinic_id: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decided_via: string | null
          decision_note: string | null
          expected: Json
          id: string
          kind: string
          member_id: string
          proposed: Json
          requested_by: string
          requested_membership: string
          state: string
          submission_id: string
        }
        Insert: {
          before: Json
          clinic_id: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decided_via?: string | null
          decision_note?: string | null
          expected: Json
          id?: string
          kind: string
          member_id: string
          proposed: Json
          requested_by: string
          requested_membership: string
          state?: string
          submission_id: string
        }
        Update: {
          before?: Json
          clinic_id?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decided_via?: string | null
          decision_note?: string | null
          expected?: Json
          id?: string
          kind?: string
          member_id?: string
          proposed?: Json
          requested_by?: string
          requested_membership?: string
          state?: string
          submission_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinic_admin_change_requests_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "workspace_clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinic_admin_change_requests_requested_membership_fkey"
            columns: ["requested_membership"]
            isOneToOne: false
            referencedRelation: "clinic_portal_memberships"
            referencedColumns: ["id"]
          },
        ]
      }
      clinic_admin_commands: {
        Row: {
          actor_id: string
          created_at: string
          payload: Json
          result: Json
          session_id: string
          state: string
          submission_id: string
        }
        Insert: {
          actor_id: string
          created_at?: string
          payload: Json
          result: Json
          session_id: string
          state: string
          submission_id: string
        }
        Update: {
          actor_id?: string
          created_at?: string
          payload?: Json
          result?: Json
          session_id?: string
          state?: string
          submission_id?: string
        }
        Relationships: []
      }
      clinic_batch_commands: {
        Row: {
          actor_id: string
          batch_id: string
          clinic_id: string
          created_at: string
          payload: Json
          result: Json
          session_id: string
          state: string
          submission_id: string
        }
        Insert: {
          actor_id: string
          batch_id: string
          clinic_id: string
          created_at?: string
          payload: Json
          result: Json
          session_id: string
          state: string
          submission_id: string
        }
        Update: {
          actor_id?: string
          batch_id?: string
          clinic_id?: string
          created_at?: string
          payload?: Json
          result?: Json
          session_id?: string
          state?: string
          submission_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinic_batch_commands_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "workspace_clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      clinic_batch_files: {
        Row: {
          actor_id: string
          amr: Json
          attempt_id: string
          batch_id: string
          cleanup: string
          created_at: string
          declared_size: number
          execution: string
          expected_sha256: string
          id: string
          jwt_expires_at: string
          logical_key: string
          measured_size: number | null
          membership_id: string
          membership_revision: number
          mime: string
          name: string
          object_id: string | null
          object_key: string
          revision: number
          session_id: string
          sha256: string | null
          state: string
          submission_id: string
        }
        Insert: {
          actor_id: string
          amr: Json
          attempt_id: string
          batch_id: string
          cleanup?: string
          created_at?: string
          declared_size: number
          execution?: string
          expected_sha256: string
          id: string
          jwt_expires_at: string
          logical_key: string
          measured_size?: number | null
          membership_id: string
          membership_revision: number
          mime: string
          name: string
          object_id?: string | null
          object_key: string
          revision?: number
          session_id: string
          sha256?: string | null
          state?: string
          submission_id: string
        }
        Update: {
          actor_id?: string
          amr?: Json
          attempt_id?: string
          batch_id?: string
          cleanup?: string
          created_at?: string
          declared_size?: number
          execution?: string
          expected_sha256?: string
          id?: string
          jwt_expires_at?: string
          logical_key?: string
          measured_size?: number | null
          membership_id?: string
          membership_revision?: number
          mime?: string
          name?: string
          object_id?: string | null
          object_key?: string
          revision?: number
          session_id?: string
          sha256?: string | null
          state?: string
          submission_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinic_batch_files_actor_id_submission_id_fkey"
            columns: ["actor_id", "submission_id"]
            isOneToOne: false
            referencedRelation: "clinic_batch_commands"
            referencedColumns: ["actor_id", "submission_id"]
          },
          {
            foreignKeyName: "clinic_batch_files_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "clinic_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      clinic_batches: {
        Row: {
          clinic_id: string
          created_at: string
          id: string
          name: string
          revision: number
          uploader_id: string
          uploader_name: string
        }
        Insert: {
          clinic_id: string
          created_at?: string
          id: string
          name: string
          revision?: number
          uploader_id: string
          uploader_name: string
        }
        Update: {
          clinic_id?: string
          created_at?: string
          id?: string
          name?: string
          revision?: number
          uploader_id?: string
          uploader_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinic_batches_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "workspace_clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      clinic_booking_checkins: {
        Row: {
          actor_id: string
          appointment_id: string
          clinic_id: string
          id: number
          membership_id: string
          outcome: string
          recorded_at: string
          reservation_id: string
          source: string
        }
        Insert: {
          actor_id: string
          appointment_id: string
          clinic_id: string
          id?: never
          membership_id: string
          outcome: string
          recorded_at?: string
          reservation_id: string
          source?: string
        }
        Update: {
          actor_id?: string
          appointment_id?: string
          clinic_id?: string
          id?: never
          membership_id?: string
          outcome?: string
          recorded_at?: string
          reservation_id?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinic_booking_checkins_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "booking_appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinic_booking_checkins_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "workspace_clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinic_booking_checkins_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "clinic_portal_memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinic_booking_checkins_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "booking_manual_reservations"
            referencedColumns: ["id"]
          },
        ]
      }
      clinic_booking_decisions: {
        Row: {
          actor_id: string
          appointment_id: string
          appointment_revision: number
          clinic_id: string
          created_at: string
          id: string
          kind: string
          membership_id: string
          notice_id: string
          reason: string | null
        }
        Insert: {
          actor_id: string
          appointment_id: string
          appointment_revision: number
          clinic_id: string
          created_at?: string
          id: string
          kind: string
          membership_id: string
          notice_id: string
          reason?: string | null
        }
        Update: {
          actor_id?: string
          appointment_id?: string
          appointment_revision?: number
          clinic_id?: string
          created_at?: string
          id?: string
          kind?: string
          membership_id?: string
          notice_id?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clinic_booking_decisions_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "booking_appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinic_booking_decisions_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "workspace_clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinic_booking_decisions_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "clinic_portal_memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinic_booking_decisions_notice_id_fkey"
            columns: ["notice_id"]
            isOneToOne: true
            referencedRelation: "booking_scheduling_notices"
            referencedColumns: ["id"]
          },
        ]
      }
      clinic_booking_proposals: {
        Row: {
          actor_id: string
          appointment_id: string
          appointment_revision: number
          capacity_key: string
          clinic_id: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          ends_at: string
          id: string
          membership_id: string
          note: string | null
          starts_at: string
          state: string
          telegram_message_id: string | null
        }
        Insert: {
          actor_id: string
          appointment_id: string
          appointment_revision: number
          capacity_key: string
          clinic_id: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          ends_at: string
          id: string
          membership_id: string
          note?: string | null
          starts_at: string
          state?: string
          telegram_message_id?: string | null
        }
        Update: {
          actor_id?: string
          appointment_id?: string
          appointment_revision?: number
          capacity_key?: string
          clinic_id?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          ends_at?: string
          id?: string
          membership_id?: string
          note?: string | null
          starts_at?: string
          state?: string
          telegram_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clinic_booking_proposals_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "booking_appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinic_booking_proposals_capacity_key_fkey"
            columns: ["capacity_key"]
            isOneToOne: false
            referencedRelation: "booking_manual_capacity"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "clinic_booking_proposals_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "workspace_clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinic_booking_proposals_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "clinic_portal_memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinic_booking_proposals_telegram_message_id_fkey"
            columns: ["telegram_message_id"]
            isOneToOne: false
            referencedRelation: "telegram_auth_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      clinic_member_profile_changes: {
        Row: {
          actor_id: string
          after: Json
          approved_by: string | null
          before: Json
          clinic_id: string
          created_at: string
          id: string
          member_id: string
          membership_id: string
          submission_id: string
        }
        Insert: {
          actor_id: string
          after: Json
          approved_by?: string | null
          before: Json
          clinic_id: string
          created_at?: string
          id?: string
          member_id: string
          membership_id: string
          submission_id: string
        }
        Update: {
          actor_id?: string
          after?: Json
          approved_by?: string | null
          before?: Json
          clinic_id?: string
          created_at?: string
          id?: string
          member_id?: string
          membership_id?: string
          submission_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinic_member_profile_changes_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "workspace_clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinic_member_profile_changes_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "clinic_portal_memberships"
            referencedColumns: ["id"]
          },
        ]
      }
      clinic_member_upload_files: {
        Row: {
          batch_id: string
          file_id: string
          state: string
          updated_at: string
        }
        Insert: {
          batch_id: string
          file_id: string
          state: string
          updated_at?: string
        }
        Update: {
          batch_id?: string
          file_id?: string
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinic_member_upload_files_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "clinic_member_uploads"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "clinic_member_upload_files_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: true
            referencedRelation: "clinic_batch_files"
            referencedColumns: ["id"]
          },
        ]
      }
      clinic_member_uploads: {
        Row: {
          actor_id: string
          batch_id: string
          clinic_id: string
          created_at: string
          member_id: string
          membership_id: string
          visit_id: string | null
        }
        Insert: {
          actor_id: string
          batch_id: string
          clinic_id: string
          created_at?: string
          member_id: string
          membership_id: string
          visit_id?: string | null
        }
        Update: {
          actor_id?: string
          batch_id?: string
          clinic_id?: string
          created_at?: string
          member_id?: string
          membership_id?: string
          visit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clinic_member_uploads_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: true
            referencedRelation: "clinic_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinic_member_uploads_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "workspace_clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinic_member_uploads_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "clinic_portal_memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinic_member_uploads_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "patient_care_visits"
            referencedColumns: ["id"]
          },
        ]
      }
      clinic_original_accesses: {
        Row: {
          actor_id: string
          amr: Json
          created_at: string
          file_id: string
          file_revision: number
          id: string
          jwt_expires_at: string
          membership_id: string
          membership_revision: number
          session_id: string
        }
        Insert: {
          actor_id: string
          amr: Json
          created_at?: string
          file_id: string
          file_revision: number
          id?: string
          jwt_expires_at: string
          membership_id: string
          membership_revision: number
          session_id: string
        }
        Update: {
          actor_id?: string
          amr?: Json
          created_at?: string
          file_id?: string
          file_revision?: number
          id?: string
          jwt_expires_at?: string
          membership_id?: string
          membership_revision?: number
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinic_original_accesses_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "clinic_batch_files"
            referencedColumns: ["id"]
          },
        ]
      }
      clinic_portal_audit: {
        Row: {
          actor_id: string | null
          batch_id: string | null
          clinic_id: string
          created_at: string
          detail: Json
          id: number
          kind: string
        }
        Insert: {
          actor_id?: string | null
          batch_id?: string | null
          clinic_id: string
          created_at?: string
          detail: Json
          id?: never
          kind: string
        }
        Update: {
          actor_id?: string | null
          batch_id?: string | null
          clinic_id?: string
          created_at?: string
          detail?: Json
          id?: never
          kind?: string
        }
        Relationships: []
      }
      clinic_portal_capabilities: {
        Row: {
          clinic_admin_full_access: boolean
          result_attach_enabled: boolean
          singleton: boolean
          storage_enabled: boolean
        }
        Insert: {
          clinic_admin_full_access?: boolean
          result_attach_enabled?: boolean
          singleton?: boolean
          storage_enabled?: boolean
        }
        Update: {
          clinic_admin_full_access?: boolean
          result_attach_enabled?: boolean
          singleton?: boolean
          storage_enabled?: boolean
        }
        Relationships: []
      }
      clinic_portal_invitations: {
        Row: {
          accepted_at: string | null
          auth_user_id: string | null
          clinic_id: string
          created_at: string
          display_name: string
          email: string
          expires_at: string
          generation: number
          id: string
          invited_phone: string
          issuer_id: string
          membership_id: string | null
          request_id: string
          status: string
          verified_at: string | null
          verified_binding_id: string | null
          verified_nonce_hmac: string | null
        }
        Insert: {
          accepted_at?: string | null
          auth_user_id?: string | null
          clinic_id: string
          created_at?: string
          display_name: string
          email: string
          expires_at: string
          generation?: number
          id?: string
          invited_phone: string
          issuer_id: string
          membership_id?: string | null
          request_id: string
          status?: string
          verified_at?: string | null
          verified_binding_id?: string | null
          verified_nonce_hmac?: string | null
        }
        Update: {
          accepted_at?: string | null
          auth_user_id?: string | null
          clinic_id?: string
          created_at?: string
          display_name?: string
          email?: string
          expires_at?: string
          generation?: number
          id?: string
          invited_phone?: string
          issuer_id?: string
          membership_id?: string | null
          request_id?: string
          status?: string
          verified_at?: string | null
          verified_binding_id?: string | null
          verified_nonce_hmac?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clinic_portal_invitations_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "workspace_clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinic_portal_invitations_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "clinic_portal_memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinic_portal_invitations_verified_binding_id_fkey"
            columns: ["verified_binding_id"]
            isOneToOne: false
            referencedRelation: "telegram_auth_bindings"
            referencedColumns: ["id"]
          },
        ]
      }
      clinic_portal_memberships: {
        Row: {
          active: boolean
          clinic_id: string
          display_name: string
          id: string
          revision: number
          role: string
          user_id: string
        }
        Insert: {
          active?: boolean
          clinic_id: string
          display_name: string
          id?: string
          revision?: number
          role?: string
          user_id: string
        }
        Update: {
          active?: boolean
          clinic_id?: string
          display_name?: string
          id?: string
          revision?: number
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinic_portal_memberships_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "workspace_clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      clinic_result_attachments: {
        Row: {
          actor_id: string
          actor_kind: string
          clinic_id: string
          created_at: string
          file_id: string
          id: string
          previous_id: string | null
          submission_id: string
          user_id: string
          visit_id: string
        }
        Insert: {
          actor_id: string
          actor_kind: string
          clinic_id: string
          created_at?: string
          file_id: string
          id?: string
          previous_id?: string | null
          submission_id: string
          user_id: string
          visit_id: string
        }
        Update: {
          actor_id?: string
          actor_kind?: string
          clinic_id?: string
          created_at?: string
          file_id?: string
          id?: string
          previous_id?: string | null
          submission_id?: string
          user_id?: string
          visit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinic_result_attachments_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "workspace_clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinic_result_attachments_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "clinic_batch_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinic_result_attachments_previous_id_fkey"
            columns: ["previous_id"]
            isOneToOne: false
            referencedRelation: "clinic_result_attachments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinic_result_attachments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "patient_clinical_cases"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "clinic_result_attachments_user_id_visit_id_fkey"
            columns: ["user_id", "visit_id"]
            isOneToOne: false
            referencedRelation: "patient_care_visits"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      clinic_result_detachments: {
        Row: {
          actor_id: string
          attachment_id: string
          created_at: string
          id: string
          reason: string
          submission_id: string
        }
        Insert: {
          actor_id: string
          attachment_id: string
          created_at?: string
          id?: string
          reason: string
          submission_id: string
        }
        Update: {
          actor_id?: string
          attachment_id?: string
          created_at?: string
          id?: string
          reason?: string
          submission_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinic_result_detachments_attachment_id_fkey"
            columns: ["attachment_id"]
            isOneToOne: true
            referencedRelation: "clinic_result_attachments"
            referencedColumns: ["id"]
          },
        ]
      }
      clinic_schedule_commands: {
        Row: {
          actor_id: string
          clinic_id: string
          created_at: string
          payload: Json
          result: Json
          submission_id: string
        }
        Insert: {
          actor_id: string
          clinic_id: string
          created_at?: string
          payload: Json
          result: Json
          submission_id: string
        }
        Update: {
          actor_id?: string
          clinic_id?: string
          created_at?: string
          payload?: Json
          result?: Json
          submission_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinic_schedule_commands_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "workspace_clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      clinic_schedule_hours: {
        Row: {
          clinic_id: string
          closes: string
          opens: string
          weekday: number
        }
        Insert: {
          clinic_id: string
          closes: string
          opens: string
          weekday: number
        }
        Update: {
          clinic_id?: string
          closes?: string
          opens?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "clinic_schedule_hours_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic_schedules"
            referencedColumns: ["clinic_id"]
          },
        ]
      }
      clinic_schedules: {
        Row: {
          active: boolean
          capacity: number
          clinic_id: string
          covered_test_ids: string[]
          follow_up_test_ids: string[]
          generated_on: string | null
          generated_version: string | null
          preparation: string
          revision: number
          slot_minutes: number
          updated_at: string
          updated_by: string
        }
        Insert: {
          active?: boolean
          capacity: number
          clinic_id: string
          covered_test_ids: string[]
          follow_up_test_ids?: string[]
          generated_on?: string | null
          generated_version?: string | null
          preparation: string
          revision?: number
          slot_minutes: number
          updated_at?: string
          updated_by: string
        }
        Update: {
          active?: boolean
          capacity?: number
          clinic_id?: string
          covered_test_ids?: string[]
          follow_up_test_ids?: string[]
          generated_on?: string | null
          generated_version?: string | null
          preparation?: string
          revision?: number
          slot_minutes?: number
          updated_at?: string
          updated_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinic_schedules_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: true
            referencedRelation: "workspace_clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      clinic_scheduling_capabilities: {
        Row: {
          enabled: boolean
          singleton: boolean
          updated_at: string
        }
        Insert: {
          enabled?: boolean
          singleton?: boolean
          updated_at?: string
        }
        Update: {
          enabled?: boolean
          singleton?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      clinic_scheduling_operations: {
        Row: {
          actor_id: string
          created_at: string
          input: Json
          operation: string
          request_id: string
          result: Json
        }
        Insert: {
          actor_id: string
          created_at?: string
          input: Json
          operation: string
          request_id: string
          result: Json
        }
        Update: {
          actor_id?: string
          created_at?: string
          input?: Json
          operation?: string
          request_id?: string
          result?: Json
        }
        Relationships: []
      }
      clinic_upload_overrides: {
        Row: {
          actor_id: string
          attachment_id: string
          clinic_id: string
          created_at: string
          file_id: string
          id: string
          member_id: string
          member_values: Json
          membership_id: string
          mismatch: string
          reason: string | null
          sheet: Json
          submission_id: string
        }
        Insert: {
          actor_id: string
          attachment_id: string
          clinic_id: string
          created_at?: string
          file_id: string
          id?: string
          member_id: string
          member_values: Json
          membership_id: string
          mismatch: string
          reason?: string | null
          sheet: Json
          submission_id: string
        }
        Update: {
          actor_id?: string
          attachment_id?: string
          clinic_id?: string
          created_at?: string
          file_id?: string
          id?: string
          member_id?: string
          member_values?: Json
          membership_id?: string
          mismatch?: string
          reason?: string | null
          sheet?: Json
          submission_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinic_upload_overrides_attachment_id_fkey"
            columns: ["attachment_id"]
            isOneToOne: true
            referencedRelation: "clinic_result_attachments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinic_upload_overrides_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "workspace_clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinic_upload_overrides_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "clinic_batch_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinic_upload_overrides_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "clinic_portal_memberships"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_events: {
        Row: {
          attempts: number
          cancelled_at: string | null
          claimed_at: string | null
          claimed_member_seq: number | null
          conversation_id: string | null
          created_at: string
          due_at: string
          event_key: string
          id: string
          iso_week: string
          kind: string
          member_id: string
          ready_at: string | null
          reason: string | null
          retry_at: string | null
          run_id: string | null
          sent_at: string | null
          state: string
          state_seq: number
          telegram_message_id: string | null
          updated_at: string
        }
        Insert: {
          attempts?: number
          cancelled_at?: string | null
          claimed_at?: string | null
          claimed_member_seq?: number | null
          conversation_id?: string | null
          created_at?: string
          due_at: string
          event_key: string
          id?: string
          iso_week: string
          kind: string
          member_id: string
          ready_at?: string | null
          reason?: string | null
          retry_at?: string | null
          run_id?: string | null
          sent_at?: string | null
          state?: string
          state_seq?: number
          telegram_message_id?: string | null
          updated_at?: string
        }
        Update: {
          attempts?: number
          cancelled_at?: string | null
          claimed_at?: string | null
          claimed_member_seq?: number | null
          conversation_id?: string | null
          created_at?: string
          due_at?: string
          event_key?: string
          id?: string
          iso_week?: string
          kind?: string
          member_id?: string
          ready_at?: string | null
          reason?: string | null
          retry_at?: string | null
          run_id?: string | null
          sent_at?: string | null
          state?: string
          state_seq?: number
          telegram_message_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "coach_events_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_events_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: true
            referencedRelation: "zoe_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_events_telegram_message_id_fkey"
            columns: ["telegram_message_id"]
            isOneToOne: true
            referencedRelation: "telegram_auth_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      config_audit: {
        Row: {
          actor_id: string | null
          at: string
          changed: Json
          db_role: string
          id: number
          operation: string
          row_key: string | null
          table_name: string
        }
        Insert: {
          actor_id?: string | null
          at?: string
          changed?: Json
          db_role: string
          id?: never
          operation: string
          row_key?: string | null
          table_name: string
        }
        Update: {
          actor_id?: string | null
          at?: string
          changed?: Json
          db_role?: string
          id?: never
          operation?: string
          row_key?: string | null
          table_name?: string
        }
        Relationships: []
      }
      consult_questions: {
        Row: {
          appointment_id: string | null
          created_at: string
          group_label: string
          id: string
          member_id: string
          request_id: string
          sent_at: string | null
          text: string
        }
        Insert: {
          appointment_id?: string | null
          created_at?: string
          group_label: string
          id?: string
          member_id: string
          request_id: string
          sent_at?: string | null
          text: string
        }
        Update: {
          appointment_id?: string | null
          created_at?: string
          group_label?: string
          id?: string
          member_id?: string
          request_id?: string
          sent_at?: string | null
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "consult_questions_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "booking_appointments"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_app_releases: {
        Row: {
          approval_id: string
          conversation_id: string
          member_id: string
          reason: string
          released_at: string
        }
        Insert: {
          approval_id: string
          conversation_id: string
          member_id: string
          reason: string
          released_at?: string
        }
        Update: {
          approval_id?: string
          conversation_id?: string
          member_id?: string
          reason?: string
          released_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_app_releases_approval_id_fkey"
            columns: ["approval_id"]
            isOneToOne: true
            referencedRelation: "conversation_approvals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_app_releases_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_approvals: {
        Row: {
          body: string
          clinic_id: string
          content_hash: string
          context_version: number
          created_at: string
          doctor_id: string
          doctor_name: string
          doctor_role: string
          draft_id: string
          grant_generation: number
          grant_id: string
          id: string
          intent_id: string
          revision: number
        }
        Insert: {
          body: string
          clinic_id: string
          content_hash: string
          context_version: number
          created_at?: string
          doctor_id: string
          doctor_name: string
          doctor_role: string
          draft_id: string
          grant_generation: number
          grant_id: string
          id?: string
          intent_id: string
          revision: number
        }
        Update: {
          body?: string
          clinic_id?: string
          content_hash?: string
          context_version?: number
          created_at?: string
          doctor_id?: string
          doctor_name?: string
          doctor_role?: string
          draft_id?: string
          grant_generation?: number
          grant_id?: string
          id?: string
          intent_id?: string
          revision?: number
        }
        Relationships: [
          {
            foreignKeyName: "conversation_approvals_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "workspace_clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_approvals_draft_id_revision_fkey"
            columns: ["draft_id", "revision"]
            isOneToOne: false
            referencedRelation: "conversation_revisions"
            referencedColumns: ["draft_id", "revision"]
          },
          {
            foreignKeyName: "conversation_approvals_grant_id_fkey"
            columns: ["grant_id"]
            isOneToOne: false
            referencedRelation: "conversation_grants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_approvals_intent_id_fkey"
            columns: ["intent_id"]
            isOneToOne: true
            referencedRelation: "conversation_intents"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_attempts: {
        Row: {
          claimed_at: string
          delivery_id: string
          envelope: Json
          id: string
          outcome: Json | null
          outcome_at: string | null
          state_seq: number
        }
        Insert: {
          claimed_at?: string
          delivery_id: string
          envelope: Json
          id: string
          outcome?: Json | null
          outcome_at?: string | null
          state_seq: number
        }
        Update: {
          claimed_at?: string
          delivery_id?: string
          envelope?: Json
          id?: string
          outcome?: Json | null
          outcome_at?: string | null
          state_seq?: number
        }
        Relationships: [
          {
            foreignKeyName: "conversation_attempts_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: true
            referencedRelation: "conversation_deliveries"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_audit: {
        Row: {
          actor_id: string | null
          conversation_id: string
          created_at: string
          detail: Json
          id: number
          kind: string
        }
        Insert: {
          actor_id?: string | null
          conversation_id: string
          created_at?: string
          detail: Json
          id?: never
          kind: string
        }
        Update: {
          actor_id?: string | null
          conversation_id?: string
          created_at?: string
          detail?: Json
          id?: never
          kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_audit_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_deliveries: {
        Row: {
          approval_id: string
          conversation_id: string
          created_at: string
          endpoint_generation: number | null
          endpoint_id: string | null
          id: string
          policy_version: string | null
          reason: string | null
          retry_of: string | null
          review_after_send: boolean
          state: string
          state_seq: number
        }
        Insert: {
          approval_id: string
          conversation_id: string
          created_at?: string
          endpoint_generation?: number | null
          endpoint_id?: string | null
          id?: string
          policy_version?: string | null
          reason?: string | null
          retry_of?: string | null
          review_after_send?: boolean
          state: string
          state_seq?: number
        }
        Update: {
          approval_id?: string
          conversation_id?: string
          created_at?: string
          endpoint_generation?: number | null
          endpoint_id?: string | null
          id?: string
          policy_version?: string | null
          reason?: string | null
          retry_of?: string | null
          review_after_send?: boolean
          state?: string
          state_seq?: number
        }
        Relationships: [
          {
            foreignKeyName: "conversation_deliveries_approval_id_fkey"
            columns: ["approval_id"]
            isOneToOne: true
            referencedRelation: "conversation_approvals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_deliveries_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_deliveries_endpoint_id_fkey"
            columns: ["endpoint_id"]
            isOneToOne: false
            referencedRelation: "conversation_endpoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_deliveries_retry_of_fkey"
            columns: ["retry_of"]
            isOneToOne: false
            referencedRelation: "conversation_deliveries"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_doctor_alerts: {
        Row: {
          conversation_id: string
          created_at: string
          doctor_id: string | null
          id: string
          inbox_id: string | null
          member_id: string
          message_seq: number
        }
        Insert: {
          conversation_id: string
          created_at?: string
          doctor_id?: string | null
          id?: string
          inbox_id?: string | null
          member_id: string
          message_seq: number
        }
        Update: {
          conversation_id?: string
          created_at?: string
          doctor_id?: string | null
          id?: string
          inbox_id?: string | null
          member_id?: string
          message_seq?: number
        }
        Relationships: [
          {
            foreignKeyName: "conversation_doctor_alerts_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_doctor_alerts_inbox_id_fkey"
            columns: ["inbox_id"]
            isOneToOne: true
            referencedRelation: "channel_inbox"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_drafts: {
        Row: {
          clinical_revision: number
          context_version: number
          conversation_id: string
          created_at: string
          id: string
          revision: number
          source_token: string
          state: string
        }
        Insert: {
          clinical_revision: number
          context_version: number
          conversation_id: string
          created_at?: string
          id?: string
          revision?: number
          source_token: string
          state: string
        }
        Update: {
          clinical_revision?: number
          context_version?: number
          conversation_id?: string
          created_at?: string
          id?: string
          revision?: number
          source_token?: string
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_drafts_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_endpoints: {
        Row: {
          account_ref: string
          active: boolean
          adapter: string
          address: string
          binding_id: string | null
          consent_source: string
          consent_version: string | null
          consented_at: string | null
          expires_at: string
          generation: number
          id: string
          max_utf16: number
          member_id: string
          policy_version: string
          principal_ref: string
        }
        Insert: {
          account_ref: string
          active?: boolean
          adapter: string
          address: string
          binding_id?: string | null
          consent_source?: string
          consent_version?: string | null
          consented_at?: string | null
          expires_at: string
          generation: number
          id?: string
          max_utf16: number
          member_id: string
          policy_version: string
          principal_ref: string
        }
        Update: {
          account_ref?: string
          active?: boolean
          adapter?: string
          address?: string
          binding_id?: string | null
          consent_source?: string
          consent_version?: string | null
          consented_at?: string | null
          expires_at?: string
          generation?: number
          id?: string
          max_utf16?: number
          member_id?: string
          policy_version?: string
          principal_ref?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_endpoints_binding_id_fkey"
            columns: ["binding_id"]
            isOneToOne: false
            referencedRelation: "telegram_auth_bindings"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_grants: {
        Row: {
          actor_id: string
          amr: Json
          expires_at: string
          generation: number
          id: string
          policy_version: string
          revoked: boolean
          session_id: string
        }
        Insert: {
          actor_id: string
          amr: Json
          expires_at: string
          generation?: number
          id?: string
          policy_version: string
          revoked?: boolean
          session_id: string
        }
        Update: {
          actor_id?: string
          amr?: Json
          expires_at?: string
          generation?: number
          id?: string
          policy_version?: string
          revoked?: boolean
          session_id?: string
        }
        Relationships: []
      }
      conversation_intents: {
        Row: {
          actor_id: string
          content_hash: string
          context_version: number
          draft_id: string
          expires_at: string
          grant_generation: number
          grant_id: string
          id: string
          purpose: string
          revision: number
          state: string
        }
        Insert: {
          actor_id: string
          content_hash: string
          context_version: number
          draft_id: string
          expires_at: string
          grant_generation: number
          grant_id: string
          id?: string
          purpose: string
          revision: number
          state?: string
        }
        Update: {
          actor_id?: string
          content_hash?: string
          context_version?: number
          draft_id?: string
          expires_at?: string
          grant_generation?: number
          grant_id?: string
          id?: string
          purpose?: string
          revision?: number
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_intents_draft_id_revision_fkey"
            columns: ["draft_id", "revision"]
            isOneToOne: false
            referencedRelation: "conversation_revisions"
            referencedColumns: ["draft_id", "revision"]
          },
          {
            foreignKeyName: "conversation_intents_grant_id_fkey"
            columns: ["grant_id"]
            isOneToOne: false
            referencedRelation: "conversation_grants"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_messages: {
        Row: {
          author_id: string
          body: string
          conversation_id: string
          created_at: string
          id: string
          request_id: string
          seq: number
          source: string
          to_doctor: boolean
          voice_receipt: string | null
        }
        Insert: {
          author_id: string
          body: string
          conversation_id: string
          created_at?: string
          id?: string
          request_id: string
          seq: number
          source: string
          to_doctor?: boolean
          voice_receipt?: string | null
        }
        Update: {
          author_id?: string
          body?: string
          conversation_id?: string
          created_at?: string
          id?: string
          request_id?: string
          seq?: number
          source?: string
          to_doctor?: boolean
          voice_receipt?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversation_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_nurse_handoffs: {
        Row: {
          context_version: number
          conversation_id: string
          message_id: string
          message_text: string
          nurse_id: string
          nurse_name: string
          observation: string
          request_id: string
          task_id: string
          topic: string
        }
        Insert: {
          context_version: number
          conversation_id: string
          message_id: string
          message_text: string
          nurse_id: string
          nurse_name: string
          observation: string
          request_id: string
          task_id: string
          topic: string
        }
        Update: {
          context_version?: number
          conversation_id?: string
          message_id?: string
          message_text?: string
          nurse_id?: string
          nurse_name?: string
          observation?: string
          request_id?: string
          task_id?: string
          topic?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_nurse_handoffs_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_nurse_handoffs_nurse_id_fkey"
            columns: ["nurse_id"]
            isOneToOne: false
            referencedRelation: "workspace_staff"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "conversation_nurse_handoffs_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: true
            referencedRelation: "patient_coordination_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_nurse_replies: {
        Row: {
          body: string
          context_version: number
          conversation_id: string
          created_at: string
          doctor_id: string
          id: string
          nurse_id: string
          nurse_name: string
          request_id: string
        }
        Insert: {
          body: string
          context_version: number
          conversation_id: string
          created_at?: string
          doctor_id: string
          id?: string
          nurse_id: string
          nurse_name: string
          request_id: string
        }
        Update: {
          body?: string
          context_version?: number
          conversation_id?: string
          created_at?: string
          doctor_id?: string
          id?: string
          nurse_id?: string
          nurse_name?: string
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_nurse_replies_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_policy: {
        Row: {
          app_chat_enabled: boolean
          clinical_protocol: string | null
          delivery_enabled: boolean
          grant_seconds: number
          intake_max_messages: number
          intake_window_seconds: number
          intent_seconds: number
          singleton: boolean
          synthetic_engine: boolean
          version: string
          zoe_chat_actions_enabled: boolean
        }
        Insert: {
          app_chat_enabled?: boolean
          clinical_protocol?: string | null
          delivery_enabled?: boolean
          grant_seconds: number
          intake_max_messages: number
          intake_window_seconds: number
          intent_seconds: number
          singleton?: boolean
          synthetic_engine?: boolean
          version: string
          zoe_chat_actions_enabled?: boolean
        }
        Update: {
          app_chat_enabled?: boolean
          clinical_protocol?: string | null
          delivery_enabled?: boolean
          grant_seconds?: number
          intake_max_messages?: number
          intake_window_seconds?: number
          intent_seconds?: number
          singleton?: boolean
          synthetic_engine?: boolean
          version?: string
          zoe_chat_actions_enabled?: boolean
        }
        Relationships: []
      }
      conversation_receipts: {
        Row: {
          actor_id: string
          conversation_id: string
          created_at: string
          generation: number
          grant_id: string
          payload: Json
          request_id: string
          result: Json
          state: string
        }
        Insert: {
          actor_id: string
          conversation_id: string
          created_at?: string
          generation: number
          grant_id: string
          payload: Json
          request_id: string
          result: Json
          state?: string
        }
        Update: {
          actor_id?: string
          conversation_id?: string
          created_at?: string
          generation?: number
          grant_id?: string
          payload?: Json
          request_id?: string
          result?: Json
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_receipts_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_receipts_grant_id_fkey"
            columns: ["grant_id"]
            isOneToOne: false
            referencedRelation: "conversation_grants"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_revisions: {
        Row: {
          author_id: string | null
          author_kind: string
          body: string
          content_hash: string
          created_at: string
          draft_id: string
          provenance: Json
          revision: number
          summary: string
        }
        Insert: {
          author_id?: string | null
          author_kind: string
          body: string
          content_hash: string
          created_at?: string
          draft_id: string
          provenance: Json
          revision: number
          summary: string
        }
        Update: {
          author_id?: string | null
          author_kind?: string
          body?: string
          content_hash?: string
          created_at?: string
          draft_id?: string
          provenance?: Json
          revision?: number
          summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_revisions_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "conversation_drafts"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_topic_breaks: {
        Row: {
          after_seq: number
          conversation_id: string
          created_at: string
          id: string
          member_id: string
        }
        Insert: {
          after_seq: number
          conversation_id: string
          created_at?: string
          id?: string
          member_id: string
        }
        Update: {
          after_seq?: number
          conversation_id?: string
          created_at?: string
          id?: string
          member_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_topic_breaks_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_trace_events: {
        Row: {
          actor_id: string | null
          actor_kind: string
          attributes: Json
          conversation_id: string | null
          id: number
          member_id: string | null
          name: string
          occurred_at: string
          outcome: string
          reason_code: string | null
          rule_id: string | null
          rule_version: string | null
          step: string
          subject_id: string | null
          subject_kind: string
        }
        Insert: {
          actor_id?: string | null
          actor_kind: string
          attributes?: Json
          conversation_id?: string | null
          id?: never
          member_id?: string | null
          name: string
          occurred_at?: string
          outcome: string
          reason_code?: string | null
          rule_id?: string | null
          rule_version?: string | null
          step: string
          subject_id?: string | null
          subject_kind: string
        }
        Update: {
          actor_id?: string | null
          actor_kind?: string
          attributes?: Json
          conversation_id?: string | null
          id?: never
          member_id?: string | null
          name?: string
          occurred_at?: string
          outcome?: string
          reason_code?: string | null
          rule_id?: string | null
          rule_version?: string | null
          step?: string
          subject_id?: string | null
          subject_kind?: string
        }
        Relationships: []
      }
      conversations: {
        Row: {
          created_at: string
          draft_epoch: number
          id: string
          member_id: string
          version: number
        }
        Insert: {
          created_at?: string
          draft_epoch?: number
          id?: string
          member_id: string
          version?: number
        }
        Update: {
          created_at?: string
          draft_epoch?: number
          id?: string
          member_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "conversations_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: true
            referencedRelation: "patient_clinical_cases"
            referencedColumns: ["user_id"]
          },
        ]
      }
      delivery_observations: {
        Row: {
          attempt_id: string
          channel: string
          observed_at: string
          outcome: Json
        }
        Insert: {
          attempt_id: string
          channel: string
          observed_at?: string
          outcome: Json
        }
        Update: {
          attempt_id?: string
          channel?: string
          observed_at?: string
          outcome?: Json
        }
        Relationships: []
      }
      demo_report_ai_attempts: {
        Row: {
          category: string
          created_at: string
          request_id: string
          session_hash: string
        }
        Insert: {
          category?: string
          created_at?: string
          request_id: string
          session_hash: string
        }
        Update: {
          category?: string
          created_at?: string
          request_id?: string
          session_hash?: string
        }
        Relationships: []
      }
      doctor_completion_capabilities: {
        Row: {
          enabled: boolean
          singleton: boolean
        }
        Insert: {
          enabled?: boolean
          singleton?: boolean
        }
        Update: {
          enabled?: boolean
          singleton?: boolean
        }
        Relationships: []
      }
      doctor_telegram_connections: {
        Row: {
          binding_generation: number
          binding_id: string
          ciphertext: string | null
          closed_at: string | null
          created_at: string
          doctor_id: string
          expires_at: string
          generation: number
          id: string
          key_version: string | null
          lease_token: string | null
          lease_until: string | null
          nonce: string | null
          session_id: string
          state: string
        }
        Insert: {
          binding_generation: number
          binding_id: string
          ciphertext?: string | null
          closed_at?: string | null
          created_at?: string
          doctor_id: string
          expires_at: string
          generation: number
          id?: string
          key_version?: string | null
          lease_token?: string | null
          lease_until?: string | null
          nonce?: string | null
          session_id: string
          state: string
        }
        Update: {
          binding_generation?: number
          binding_id?: string
          ciphertext?: string | null
          closed_at?: string | null
          created_at?: string
          doctor_id?: string
          expires_at?: string
          generation?: number
          id?: string
          key_version?: string | null
          lease_token?: string | null
          lease_until?: string | null
          nonce?: string | null
          session_id?: string
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "doctor_telegram_connections_binding_id_fkey"
            columns: ["binding_id"]
            isOneToOne: false
            referencedRelation: "telegram_auth_bindings"
            referencedColumns: ["id"]
          },
        ]
      }
      doctor_telegram_settings: {
        Row: {
          enabled: boolean
          singleton: boolean
        }
        Insert: {
          enabled?: boolean
          singleton?: boolean
        }
        Update: {
          enabled?: boolean
          singleton?: boolean
        }
        Relationships: []
      }
      first_note_backlog_closures: {
        Row: {
          closed_at: string
          closed_by: string
          member_id: string
          reason: string
        }
        Insert: {
          closed_at?: string
          closed_by: string
          member_id: string
          reason: string
        }
        Update: {
          closed_at?: string
          closed_by?: string
          member_id?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "first_note_backlog_closures_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: true
            referencedRelation: "patient_clinical_cases"
            referencedColumns: ["user_id"]
          },
        ]
      }
      gp_report_capabilities: {
        Row: {
          enabled: boolean
          singleton: boolean
        }
        Insert: {
          enabled?: boolean
          singleton?: boolean
        }
        Update: {
          enabled?: boolean
          singleton?: boolean
        }
        Relationships: []
      }
      gp_report_doctor_entries: {
        Row: {
          entered_at: string
          entered_by: string
          entered_by_name: string
          field: string
          finding: string | null
          id: string
          member_id: string
          number_value: number | null
          observed_on: string
          submission_id: string
        }
        Insert: {
          entered_at?: string
          entered_by: string
          entered_by_name: string
          field: string
          finding?: string | null
          id?: string
          member_id: string
          number_value?: number | null
          observed_on: string
          submission_id: string
        }
        Update: {
          entered_at?: string
          entered_by?: string
          entered_by_name?: string
          field?: string
          finding?: string | null
          id?: string
          member_id?: string
          number_value?: number | null
          observed_on?: string
          submission_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gp_report_doctor_entries_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "patient_clinical_cases"
            referencedColumns: ["user_id"]
          },
        ]
      }
      gp_report_versions: {
        Row: {
          algorithm_version: string
          approved_at: string
          approved_by: string
          approved_by_name: string
          content: Json
          content_sha256: string
          id: string
          member_id: string
          source_token: string
          submission_id: string
          template_version: string
          version: number
        }
        Insert: {
          algorithm_version: string
          approved_at?: string
          approved_by: string
          approved_by_name: string
          content: Json
          content_sha256: string
          id?: string
          member_id: string
          source_token: string
          submission_id: string
          template_version: string
          version: number
        }
        Update: {
          algorithm_version?: string
          approved_at?: string
          approved_by?: string
          approved_by_name?: string
          content?: Json
          content_sha256?: string
          id?: string
          member_id?: string
          source_token?: string
          submission_id?: string
          template_version?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "gp_report_versions_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "patient_clinical_cases"
            referencedColumns: ["user_id"]
          },
        ]
      }
      home_visit_dispatches: {
        Row: {
          created_at: string
          id: number
          nurse_id: string | null
          outcome: string
          reason: string
          request_id: string
          request_revision: number
          telegram_message_id: string | null
        }
        Insert: {
          created_at?: string
          id?: never
          nurse_id?: string | null
          outcome: string
          reason: string
          request_id: string
          request_revision: number
          telegram_message_id?: string | null
        }
        Update: {
          created_at?: string
          id?: never
          nurse_id?: string | null
          outcome?: string
          reason?: string
          request_id?: string
          request_revision?: number
          telegram_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "home_visit_dispatches_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "patient_test_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "home_visit_dispatches_telegram_message_id_fkey"
            columns: ["telegram_message_id"]
            isOneToOne: true
            referencedRelation: "telegram_auth_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      home_visit_settings: {
        Row: {
          auto_close: boolean
          singleton: boolean
          telegram_notice: boolean
          updated_at: string
        }
        Insert: {
          auto_close?: boolean
          singleton?: boolean
          telegram_notice?: boolean
          updated_at?: string
        }
        Update: {
          auto_close?: boolean
          singleton?: boolean
          telegram_notice?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      job_runs: {
        Row: {
          counts: Json
          deadline_at: string
          duration_ms: number | null
          error_code: string | null
          finished_at: string | null
          id: string
          job: string
          outcome: string | null
          started_at: string
          trigger: string
        }
        Insert: {
          counts?: Json
          deadline_at: string
          duration_ms?: number | null
          error_code?: string | null
          finished_at?: string | null
          id?: string
          job: string
          outcome?: string | null
          started_at?: string
          trigger: string
        }
        Update: {
          counts?: Json
          deadline_at?: string
          duration_ms?: number | null
          error_code?: string | null
          finished_at?: string | null
          id?: string
          job?: string
          outcome?: string | null
          started_at?: string
          trigger?: string
        }
        Relationships: []
      }
      lab_ai_auto_confirmations: {
        Row: {
          created_at: string
          event: string
          id: number
          job_id: string
          rule_version: string
          value_id: string
        }
        Insert: {
          created_at?: string
          event?: string
          id?: never
          job_id: string
          rule_version: string
          value_id: string
        }
        Update: {
          created_at?: string
          event?: string
          id?: never
          job_id?: string
          rule_version?: string
          value_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lab_ai_auto_confirmations_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "lab_ai_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_ai_auto_confirmations_value_id_fkey"
            columns: ["value_id"]
            isOneToOne: true
            referencedRelation: "lab_ai_values"
            referencedColumns: ["id"]
          },
        ]
      }
      lab_ai_calls: {
        Row: {
          cost_usd: number | null
          created_at: string
          estimate_usd: number
          fallback_used: boolean
          finished_at: string | null
          id: string
          input_tokens: number | null
          job_id: string | null
          latency_ms: number | null
          local: boolean
          model: string
          outcome: string | null
          output_tokens: number | null
          provider: string | null
          purpose: string
          refusal: string | null
          reserved: boolean
          response_model: string | null
          spend_day: string
          tier: string
        }
        Insert: {
          cost_usd?: number | null
          created_at?: string
          estimate_usd: number
          fallback_used?: boolean
          finished_at?: string | null
          id?: string
          input_tokens?: number | null
          job_id?: string | null
          latency_ms?: number | null
          local: boolean
          model: string
          outcome?: string | null
          output_tokens?: number | null
          provider?: string | null
          purpose: string
          refusal?: string | null
          reserved: boolean
          response_model?: string | null
          spend_day: string
          tier: string
        }
        Update: {
          cost_usd?: number | null
          created_at?: string
          estimate_usd?: number
          fallback_used?: boolean
          finished_at?: string | null
          id?: string
          input_tokens?: number | null
          job_id?: string | null
          latency_ms?: number | null
          local?: boolean
          model?: string
          outcome?: string | null
          output_tokens?: number | null
          provider?: string | null
          purpose?: string
          refusal?: string | null
          reserved?: boolean
          response_model?: string | null
          spend_day?: string
          tier?: string
        }
        Relationships: [
          {
            foreignKeyName: "lab_ai_calls_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "lab_ai_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      lab_ai_capabilities: {
        Row: {
          auto_accept_enabled: boolean
          auto_accept_margin: number
          enabled: boolean
          member_upload_doctor_approval: boolean
          member_upload_enabled: boolean
          singleton: boolean
        }
        Insert: {
          auto_accept_enabled?: boolean
          auto_accept_margin?: number
          enabled?: boolean
          member_upload_doctor_approval?: boolean
          member_upload_enabled?: boolean
          singleton?: boolean
        }
        Update: {
          auto_accept_enabled?: boolean
          auto_accept_margin?: number
          enabled?: boolean
          member_upload_doctor_approval?: boolean
          member_upload_enabled?: boolean
          singleton?: boolean
        }
        Relationships: []
      }
      lab_ai_confirm_passing_commands: {
        Row: {
          actor_id: string
          attachment_id: string
          confirmed: number
          created_at: string
          member_id: string
          remaining: number
          submission_id: string
        }
        Insert: {
          actor_id: string
          attachment_id: string
          confirmed: number
          created_at?: string
          member_id: string
          remaining: number
          submission_id: string
        }
        Update: {
          actor_id?: string
          attachment_id?: string
          confirmed?: number
          created_at?: string
          member_id?: string
          remaining?: number
          submission_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lab_ai_confirm_passing_commands_attachment_id_fkey"
            columns: ["attachment_id"]
            isOneToOne: false
            referencedRelation: "clinic_result_attachments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_ai_confirm_passing_commands_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "patient_clinical_cases"
            referencedColumns: ["user_id"]
          },
        ]
      }
      lab_ai_jobs: {
        Row: {
          attachment_id: string | null
          attempts: number
          clinic_id: string | null
          created_at: string
          extraction: Json | null
          file_id: string | null
          finished_at: string | null
          id: string
          identity: Json | null
          identity_confirmed_at: string | null
          identity_confirmed_by: string | null
          identity_note: string | null
          identity_status: string | null
          kind: string
          lease_token: string | null
          lease_until: string | null
          member_document_id: string | null
          member_id: string | null
          model: string | null
          next_attempt_at: string
          outcome: string | null
          page_count: number | null
          provider: string | null
          requested_by: string | null
          retry_requested_at: string | null
          source_sha256: string | null
          started_at: string | null
          state: string
          suggestions: Json | null
          summary: Json | null
          user_id: string | null
        }
        Insert: {
          attachment_id?: string | null
          attempts?: number
          clinic_id?: string | null
          created_at?: string
          extraction?: Json | null
          file_id?: string | null
          finished_at?: string | null
          id?: string
          identity?: Json | null
          identity_confirmed_at?: string | null
          identity_confirmed_by?: string | null
          identity_note?: string | null
          identity_status?: string | null
          kind?: string
          lease_token?: string | null
          lease_until?: string | null
          member_document_id?: string | null
          member_id?: string | null
          model?: string | null
          next_attempt_at?: string
          outcome?: string | null
          page_count?: number | null
          provider?: string | null
          requested_by?: string | null
          retry_requested_at?: string | null
          source_sha256?: string | null
          started_at?: string | null
          state?: string
          suggestions?: Json | null
          summary?: Json | null
          user_id?: string | null
        }
        Update: {
          attachment_id?: string | null
          attempts?: number
          clinic_id?: string | null
          created_at?: string
          extraction?: Json | null
          file_id?: string | null
          finished_at?: string | null
          id?: string
          identity?: Json | null
          identity_confirmed_at?: string | null
          identity_confirmed_by?: string | null
          identity_note?: string | null
          identity_status?: string | null
          kind?: string
          lease_token?: string | null
          lease_until?: string | null
          member_document_id?: string | null
          member_id?: string | null
          model?: string | null
          next_attempt_at?: string
          outcome?: string | null
          page_count?: number | null
          provider?: string | null
          requested_by?: string | null
          retry_requested_at?: string | null
          source_sha256?: string | null
          started_at?: string | null
          state?: string
          suggestions?: Json | null
          summary?: Json | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lab_ai_jobs_attachment_id_fkey"
            columns: ["attachment_id"]
            isOneToOne: true
            referencedRelation: "clinic_result_attachments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_ai_jobs_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "workspace_clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_ai_jobs_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "clinic_batch_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_ai_jobs_member_document_id_fkey"
            columns: ["member_document_id"]
            isOneToOne: false
            referencedRelation: "member_reported_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_ai_jobs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "patient_clinical_cases"
            referencedColumns: ["user_id"]
          },
        ]
      }
      lab_ai_value_reviews: {
        Row: {
          action: string
          actor_id: string
          after: Json
          before: Json
          created_at: string
          id: number
          submission_id: string
          value_id: string
        }
        Insert: {
          action: string
          actor_id: string
          after: Json
          before: Json
          created_at?: string
          id?: never
          submission_id: string
          value_id: string
        }
        Update: {
          action?: string
          actor_id?: string
          after?: Json
          before?: Json
          created_at?: string
          id?: never
          submission_id?: string
          value_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lab_ai_value_reviews_value_id_fkey"
            columns: ["value_id"]
            isOneToOne: false
            referencedRelation: "lab_ai_values"
            referencedColumns: ["id"]
          },
        ]
      }
      lab_ai_values: {
        Row: {
          attachment_id: string
          attention: string | null
          attention_rule: string | null
          auto_accept_rule: string | null
          auto_accepted_at: string | null
          catalogue_ref: string | null
          checks: string[]
          collected_on: string | null
          corrected_unit: string | null
          corrected_value: number | null
          created_at: string
          file_id: string
          id: string
          job_id: string
          lab_flag: string | null
          lab_name: string | null
          page: number
          ref_high: number | null
          ref_low: number | null
          ref_text: string | null
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          seq: number
          snippet: string | null
          source: string
          status: string
          test_name: string
          unit: string | null
          user_id: string
          value: number | null
          value_text: string
        }
        Insert: {
          attachment_id: string
          attention?: string | null
          attention_rule?: string | null
          auto_accept_rule?: string | null
          auto_accepted_at?: string | null
          catalogue_ref?: string | null
          checks?: string[]
          collected_on?: string | null
          corrected_unit?: string | null
          corrected_value?: number | null
          created_at?: string
          file_id: string
          id?: string
          job_id: string
          lab_flag?: string | null
          lab_name?: string | null
          page: number
          ref_high?: number | null
          ref_low?: number | null
          ref_text?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          seq: number
          snippet?: string | null
          source?: string
          status?: string
          test_name: string
          unit?: string | null
          user_id: string
          value?: number | null
          value_text: string
        }
        Update: {
          attachment_id?: string
          attention?: string | null
          attention_rule?: string | null
          auto_accept_rule?: string | null
          auto_accepted_at?: string | null
          catalogue_ref?: string | null
          checks?: string[]
          collected_on?: string | null
          corrected_unit?: string | null
          corrected_value?: number | null
          created_at?: string
          file_id?: string
          id?: string
          job_id?: string
          lab_flag?: string | null
          lab_name?: string | null
          page?: number
          ref_high?: number | null
          ref_low?: number | null
          ref_text?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          seq?: number
          snippet?: string | null
          source?: string
          status?: string
          test_name?: string
          unit?: string | null
          user_id?: string
          value?: number | null
          value_text?: string
        }
        Relationships: [
          {
            foreignKeyName: "lab_ai_values_attachment_id_fkey"
            columns: ["attachment_id"]
            isOneToOne: false
            referencedRelation: "clinic_result_attachments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_ai_values_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "clinic_batch_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_ai_values_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "lab_ai_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_ai_values_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "patient_clinical_cases"
            referencedColumns: ["user_id"]
          },
        ]
      }
      ldl_goal_settings: {
        Row: {
          ldl_goal_enabled: boolean
          ldl_response_enabled: boolean
          lipid_planner_enabled: boolean
          singleton: boolean
          updated_at: string
        }
        Insert: {
          ldl_goal_enabled?: boolean
          ldl_response_enabled?: boolean
          lipid_planner_enabled?: boolean
          singleton?: boolean
          updated_at?: string
        }
        Update: {
          ldl_goal_enabled?: boolean
          ldl_response_enabled?: boolean
          lipid_planner_enabled?: boolean
          singleton?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      ldl_goals: {
        Row: {
          baseline_kind: string
          baseline_mmol: number | null
          baseline_on: string | null
          baseline_source: string | null
          category: string
          defaults_version: string
          id: string
          member_id: string
          next_test_on: string | null
          reason: string | null
          reduction_pct: number | null
          reduction_rule: boolean
          set_at: string
          set_by: string
          submission_id: string
          threshold_mmol: number
          version: number
        }
        Insert: {
          baseline_kind: string
          baseline_mmol?: number | null
          baseline_on?: string | null
          baseline_source?: string | null
          category: string
          defaults_version: string
          id?: string
          member_id: string
          next_test_on?: string | null
          reason?: string | null
          reduction_pct?: number | null
          reduction_rule: boolean
          set_at?: string
          set_by: string
          submission_id: string
          threshold_mmol: number
          version: number
        }
        Update: {
          baseline_kind?: string
          baseline_mmol?: number | null
          baseline_on?: string | null
          baseline_source?: string | null
          category?: string
          defaults_version?: string
          id?: string
          member_id?: string
          next_test_on?: string | null
          reason?: string | null
          reduction_pct?: number | null
          reduction_rule?: boolean
          set_at?: string
          set_by?: string
          submission_id?: string
          threshold_mmol?: number
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "ldl_goals_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "patient_clinical_cases"
            referencedColumns: ["user_id"]
          },
        ]
      }
      ldl_index_events: {
        Row: {
          event_on: string | null
          event_other: string | null
          event_type: string
          id: string
          member_id: string
          note: string | null
          recorded_at: string
          recorded_by: string
          removed_at: string | null
          removed_by: string | null
          source: string
          submission_id: string
        }
        Insert: {
          event_on?: string | null
          event_other?: string | null
          event_type: string
          id?: string
          member_id: string
          note?: string | null
          recorded_at?: string
          recorded_by: string
          removed_at?: string | null
          removed_by?: string | null
          source: string
          submission_id: string
        }
        Update: {
          event_on?: string | null
          event_other?: string | null
          event_type?: string
          id?: string
          member_id?: string
          note?: string | null
          recorded_at?: string
          recorded_by?: string
          removed_at?: string | null
          removed_by?: string | null
          source?: string
          submission_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ldl_index_events_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "patient_clinical_cases"
            referencedColumns: ["user_id"]
          },
        ]
      }
      ldl_lipid_therapies: {
        Row: {
          dose: string
          drug: string
          drug_other: string | null
          end_reason: string | null
          ended_at: string | null
          ended_by: string | null
          id: string
          maximally_tolerated: boolean
          member_id: string
          recorded_at: string
          recorded_by: string
          started_on: string | null
          stopped_on: string | null
          submission_id: string
        }
        Insert: {
          dose: string
          drug: string
          drug_other?: string | null
          end_reason?: string | null
          ended_at?: string | null
          ended_by?: string | null
          id?: string
          maximally_tolerated?: boolean
          member_id: string
          recorded_at?: string
          recorded_by: string
          started_on?: string | null
          stopped_on?: string | null
          submission_id: string
        }
        Update: {
          dose?: string
          drug?: string
          drug_other?: string | null
          end_reason?: string | null
          ended_at?: string | null
          ended_by?: string | null
          id?: string
          maximally_tolerated?: boolean
          member_id?: string
          recorded_at?: string
          recorded_by?: string
          started_on?: string | null
          stopped_on?: string | null
          submission_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ldl_lipid_therapies_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "patient_clinical_cases"
            referencedColumns: ["user_id"]
          },
        ]
      }
      ldl_response_skips: {
        Row: {
          created_at: string
          member_id: string
          observation_key: string
        }
        Insert: {
          created_at?: string
          member_id: string
          observation_key: string
        }
        Update: {
          created_at?: string
          member_id?: string
          observation_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "ldl_response_skips_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "patient_clinical_cases"
            referencedColumns: ["user_id"]
          },
        ]
      }
      ldl_responses: {
        Row: {
          close_note: string | null
          closed_at: string | null
          closed_by: string | null
          created_at: string
          doctor_id: string
          facts: Json
          id: string
          member_id: string
          observation_key: string
          observed_on: string
          retest_id: string | null
          status: string
        }
        Insert: {
          close_note?: string | null
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          doctor_id: string
          facts: Json
          id?: string
          member_id: string
          observation_key: string
          observed_on: string
          retest_id?: string | null
          status: string
        }
        Update: {
          close_note?: string | null
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          doctor_id?: string
          facts?: Json
          id?: string
          member_id?: string
          observation_key?: string
          observed_on?: string
          retest_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "ldl_responses_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "patient_clinical_cases"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "ldl_responses_retest"
            columns: ["retest_id"]
            isOneToOne: false
            referencedRelation: "ldl_retests"
            referencedColumns: ["id"]
          },
        ]
      }
      ldl_retests: {
        Row: {
          admin_ack_at: string | null
          admin_ack_by: string | null
          admin_note: string | null
          anchor_on: string
          closed_at: string | null
          closed_by: string | null
          created_at: string
          created_by: string
          defaults_version: string
          due_from: string
          due_to: string
          fence_ack_at: string | null
          fence_ack_by: string | null
          fence_reason: string | null
          id: string
          member_id: string
          opened_at: string | null
          overdue_at: string | null
          request_id: string | null
          request_on: string
          response_id: string | null
          rule: string
          state: string
          therapy_id: string
        }
        Insert: {
          admin_ack_at?: string | null
          admin_ack_by?: string | null
          admin_note?: string | null
          anchor_on: string
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          created_by: string
          defaults_version: string
          due_from: string
          due_to: string
          fence_ack_at?: string | null
          fence_ack_by?: string | null
          fence_reason?: string | null
          id?: string
          member_id: string
          opened_at?: string | null
          overdue_at?: string | null
          request_id?: string | null
          request_on: string
          response_id?: string | null
          rule: string
          state?: string
          therapy_id: string
        }
        Update: {
          admin_ack_at?: string | null
          admin_ack_by?: string | null
          admin_note?: string | null
          anchor_on?: string
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          created_by?: string
          defaults_version?: string
          due_from?: string
          due_to?: string
          fence_ack_at?: string | null
          fence_ack_by?: string | null
          fence_reason?: string | null
          id?: string
          member_id?: string
          opened_at?: string | null
          overdue_at?: string | null
          request_id?: string | null
          request_on?: string
          response_id?: string | null
          rule?: string
          state?: string
          therapy_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ldl_retests_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "patient_clinical_cases"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "ldl_retests_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "patient_test_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ldl_retests_response_id_fkey"
            columns: ["response_id"]
            isOneToOne: false
            referencedRelation: "ldl_responses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ldl_retests_therapy_id_fkey"
            columns: ["therapy_id"]
            isOneToOne: true
            referencedRelation: "ldl_lipid_therapies"
            referencedColumns: ["id"]
          },
        ]
      }
      member_callback_notices: {
        Row: {
          created_at: string
          id: string
          recipient_id: string
          request_id: string
          telegram_message_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          recipient_id: string
          request_id: string
          telegram_message_id: string
        }
        Update: {
          created_at?: string
          id?: string
          recipient_id?: string
          request_id?: string
          telegram_message_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_callback_notices_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "member_callback_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_callback_notices_telegram_message_id_fkey"
            columns: ["telegram_message_id"]
            isOneToOne: true
            referencedRelation: "telegram_auth_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      member_callback_requests: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          closed_by_role: string | null
          contact_channel: string
          contact_times: string[]
          created_at: string
          id: string
          member_id: string
          outcome: string | null
          requested_from: string
          state: string
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          closed_by_role?: string | null
          contact_channel: string
          contact_times: string[]
          created_at?: string
          id?: string
          member_id: string
          outcome?: string | null
          requested_from: string
          state?: string
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          closed_by_role?: string | null
          contact_channel?: string
          contact_times?: string[]
          created_at?: string
          id?: string
          member_id?: string
          outcome?: string | null
          requested_from?: string
          state?: string
        }
        Relationships: []
      }
      member_callback_settings: {
        Row: {
          daily_limit: number
          enabled: boolean
          singleton: boolean
          updated_at: string
        }
        Insert: {
          daily_limit?: number
          enabled?: boolean
          singleton?: boolean
          updated_at?: string
        }
        Update: {
          daily_limit?: number
          enabled?: boolean
          singleton?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      member_first_note_settings: {
        Row: {
          due_hours: number
          enabled: boolean
          singleton: boolean
          updated_at: string
        }
        Insert: {
          due_hours?: number
          enabled?: boolean
          singleton?: boolean
          updated_at?: string
        }
        Update: {
          due_hours?: number
          enabled?: boolean
          singleton?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      member_first_notes: {
        Row: {
          approved_at: string
          assessment_completed_at: string
          builder_version: string
          doctor_id: string
          edited: boolean
          sources: string[]
          submission_id: string
          text_en: string
          text_hy: string
          user_id: string
        }
        Insert: {
          approved_at?: string
          assessment_completed_at: string
          builder_version: string
          doctor_id: string
          edited: boolean
          sources?: string[]
          submission_id: string
          text_en: string
          text_hy: string
          user_id: string
        }
        Update: {
          approved_at?: string
          assessment_completed_at?: string
          builder_version?: string
          doctor_id?: string
          edited?: boolean
          sources?: string[]
          submission_id?: string
          text_en?: string
          text_hy?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_first_notes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "patient_clinical_cases"
            referencedColumns: ["user_id"]
          },
        ]
      }
      member_lesson_done: {
        Row: {
          done_at: string
          lesson_id: string
          user_id: string
        }
        Insert: {
          done_at?: string
          lesson_id: string
          user_id: string
        }
        Update: {
          done_at?: string
          lesson_id?: string
          user_id?: string
        }
        Relationships: []
      }
      member_lesson_offers: {
        Row: {
          dismissed_at: string | null
          lesson_id: string
          offered_at: string
          offered_on: string
          user_id: string
        }
        Insert: {
          dismissed_at?: string | null
          lesson_id: string
          offered_at?: string
          offered_on: string
          user_id: string
        }
        Update: {
          dismissed_at?: string | null
          lesson_id?: string
          offered_at?: string
          offered_on?: string
          user_id?: string
        }
        Relationships: []
      }
      member_medicine_asks: {
        Row: {
          answered_at: string | null
          created_at: string
          due_at: string
          expires_at: string
          id: string
          medicine_id: string
          notice_at: string | null
          reason: string | null
          source: string
          state: string
          trigger: string
          user_id: string
        }
        Insert: {
          answered_at?: string | null
          created_at?: string
          due_at: string
          expires_at: string
          id?: string
          medicine_id: string
          notice_at?: string | null
          reason?: string | null
          source: string
          state?: string
          trigger: string
          user_id: string
        }
        Update: {
          answered_at?: string | null
          created_at?: string
          due_at?: string
          expires_at?: string
          id?: string
          medicine_id?: string
          notice_at?: string | null
          reason?: string | null
          source?: string
          state?: string
          trigger?: string
          user_id?: string
        }
        Relationships: []
      }
      member_medicine_concerns: {
        Row: {
          ask_id: string
          created_at: string
          handled_at: string | null
          handled_by: string | null
          id: string
          kind: string
          state: string
          user_id: string
        }
        Insert: {
          ask_id: string
          created_at?: string
          handled_at?: string | null
          handled_by?: string | null
          id?: string
          kind: string
          state?: string
          user_id: string
        }
        Update: {
          ask_id?: string
          created_at?: string
          handled_at?: string | null
          handled_by?: string | null
          id?: string
          kind?: string
          state?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_medicine_concerns_ask_id_fkey"
            columns: ["ask_id"]
            isOneToOne: true
            referencedRelation: "member_medicine_asks"
            referencedColumns: ["id"]
          },
        ]
      }
      member_medicine_doses: {
        Row: {
          due_at: string
          medicine_id: string
          recorded_at: string
          revision: number
          status: string
          user_id: string
        }
        Insert: {
          due_at: string
          medicine_id: string
          recorded_at?: string
          revision?: number
          status: string
          user_id: string
        }
        Update: {
          due_at?: string
          medicine_id?: string
          recorded_at?: string
          revision?: number
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_medicine_doses_medicine_id_user_id_fkey"
            columns: ["medicine_id", "user_id"]
            isOneToOne: false
            referencedRelation: "member_medicines"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      member_medicine_settings: {
        Row: {
          asks: boolean
          enabled: boolean
          reminders: boolean
          singleton: boolean
          updated_at: string
        }
        Insert: {
          asks?: boolean
          enabled?: boolean
          reminders?: boolean
          singleton?: boolean
          updated_at?: string
        }
        Update: {
          asks?: boolean
          enabled?: boolean
          reminders?: boolean
          singleton?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      member_medicine_status_events: {
        Row: {
          id: number
          medicine_id: string
          restored_at: string
          status: string
          stop_reason: string | null
          stopped_at: string
          user_id: string
        }
        Insert: {
          id?: never
          medicine_id: string
          restored_at?: string
          status: string
          stop_reason?: string | null
          stopped_at: string
          user_id: string
        }
        Update: {
          id?: never
          medicine_id?: string
          restored_at?: string
          status?: string
          stop_reason?: string | null
          stopped_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_medicine_status_events_medicine_id_user_id_fkey"
            columns: ["medicine_id", "user_id"]
            isOneToOne: false
            referencedRelation: "member_medicines"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      member_medicines: {
        Row: {
          class: string | null
          created_at: string
          dose: string | null
          effective_at: string | null
          from_chat_at: string | null
          id: string
          name: string
          provenance: string | null
          replaced_by: string | null
          request_id: string | null
          source: string
          started_on: string
          status: string | null
          stop_reason: string | null
          stopped_at: string | null
          times: string[]
          user_id: string
        }
        Insert: {
          class?: string | null
          created_at?: string
          dose?: string | null
          effective_at?: string | null
          from_chat_at?: string | null
          id?: string
          name: string
          provenance?: string | null
          replaced_by?: string | null
          request_id?: string | null
          source?: string
          started_on: string
          status?: string | null
          stop_reason?: string | null
          stopped_at?: string | null
          times: string[]
          user_id: string
        }
        Update: {
          class?: string | null
          created_at?: string
          dose?: string | null
          effective_at?: string | null
          from_chat_at?: string | null
          id?: string
          name?: string
          provenance?: string | null
          replaced_by?: string | null
          request_id?: string | null
          source?: string
          started_on?: string
          status?: string | null
          stop_reason?: string | null
          stopped_at?: string | null
          times?: string[]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_medicines_replaced_by_fkey"
            columns: ["replaced_by"]
            isOneToOne: false
            referencedRelation: "member_medicines"
            referencedColumns: ["id"]
          },
        ]
      }
      member_notice_seen: {
        Row: {
          member_id: string
          seen_at: string
        }
        Insert: {
          member_id: string
          seen_at: string
        }
        Update: {
          member_id?: string
          seen_at?: string
        }
        Relationships: []
      }
      member_notice_settings: {
        Row: {
          app_origin: string
          booking: boolean
          care: boolean
          hourly_cap: number
          reminders: boolean
          results: boolean
          singleton: boolean
          throttle_seconds: number
          updated_at: string
        }
        Insert: {
          app_origin?: string
          booking?: boolean
          care?: boolean
          hourly_cap?: number
          reminders?: boolean
          results?: boolean
          singleton?: boolean
          throttle_seconds?: number
          updated_at?: string
        }
        Update: {
          app_origin?: string
          booking?: boolean
          care?: boolean
          hourly_cap?: number
          reminders?: boolean
          results?: boolean
          singleton?: boolean
          throttle_seconds?: number
          updated_at?: string
        }
        Relationships: []
      }
      member_notices: {
        Row: {
          app_text: string | null
          created_at: string
          event_key: string
          id: string
          member_id: string
          notice_group: string
          outcome: string
          params: Json | null
          reason: string
          telegram_message_id: string | null
          template_id: string
        }
        Insert: {
          app_text?: string | null
          created_at?: string
          event_key: string
          id?: string
          member_id: string
          notice_group: string
          outcome: string
          params?: Json | null
          reason: string
          telegram_message_id?: string | null
          template_id: string
        }
        Update: {
          app_text?: string | null
          created_at?: string
          event_key?: string
          id?: string
          member_id?: string
          notice_group?: string
          outcome?: string
          params?: Json | null
          reason?: string
          telegram_message_id?: string | null
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_notices_telegram_message_id_fkey"
            columns: ["telegram_message_id"]
            isOneToOne: true
            referencedRelation: "telegram_auth_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      member_preferences: {
        Row: {
          caregiver_contact: Json | null
          contact_channel: string
          contact_times: string[]
          preferred_channel: string | null
          text_size: string
          updated_at: string
          user_id: string
        }
        Insert: {
          caregiver_contact?: Json | null
          contact_channel?: string
          contact_times?: string[]
          preferred_channel?: string | null
          text_size?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          caregiver_contact?: Json | null
          contact_channel?: string
          contact_times?: string[]
          preferred_channel?: string | null
          text_size?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      member_push_deliveries: {
        Row: {
          attempt_id: string | null
          attempts: number
          created_at: string
          id: string
          member_id: string
          next_attempt_at: string
          notice_id: string
          state: string
          subscription_generation: number
          subscription_id: string
          updated_at: string
        }
        Insert: {
          attempt_id?: string | null
          attempts?: number
          created_at?: string
          id?: string
          member_id: string
          next_attempt_at?: string
          notice_id: string
          state?: string
          subscription_generation: number
          subscription_id: string
          updated_at?: string
        }
        Update: {
          attempt_id?: string | null
          attempts?: number
          created_at?: string
          id?: string
          member_id?: string
          next_attempt_at?: string
          notice_id?: string
          state?: string
          subscription_generation?: number
          subscription_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_push_deliveries_notice_id_fkey"
            columns: ["notice_id"]
            isOneToOne: false
            referencedRelation: "member_notices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_push_deliveries_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "member_push_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      member_push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          generation: number
          id: string
          last_ok_at: string | null
          member_id: string
          p256dh: string
          updated_at: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          generation?: number
          id?: string
          last_ok_at?: string | null
          member_id: string
          p256dh: string
          updated_at?: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          generation?: number
          id?: string
          last_ok_at?: string | null
          member_id?: string
          p256dh?: string
          updated_at?: string
        }
        Relationships: []
      }
      member_reported_documents: {
        Row: {
          auto_read_allowed: boolean
          classification_confidence: number | null
          created_at: string
          deleted_at: string | null
          doc_type: string | null
          file_name: string
          id: string
          mime: string
          object_path: string
          result_date: string | null
          sha256: string
          size_bytes: number
          source: string
          storage_purged_at: string | null
          study_date: string | null
          uploader_role: string | null
          user_id: string
        }
        Insert: {
          auto_read_allowed?: boolean
          classification_confidence?: number | null
          created_at?: string
          deleted_at?: string | null
          doc_type?: string | null
          file_name: string
          id?: string
          mime: string
          object_path: string
          result_date?: string | null
          sha256: string
          size_bytes: number
          source?: string
          storage_purged_at?: string | null
          study_date?: string | null
          uploader_role?: string | null
          user_id: string
        }
        Update: {
          auto_read_allowed?: boolean
          classification_confidence?: number | null
          created_at?: string
          deleted_at?: string | null
          doc_type?: string | null
          file_name?: string
          id?: string
          mime?: string
          object_path?: string
          result_date?: string | null
          sha256?: string
          size_bytes?: number
          source?: string
          storage_purged_at?: string | null
          study_date?: string | null
          uploader_role?: string | null
          user_id?: string
        }
        Relationships: []
      }
      member_reported_values: {
        Row: {
          ai_value_id: string | null
          created_at: string
          id: string
          measure: string
          measured_on: string
          source: string
          unit: string
          user_id: string
          value: number
          value2: number | null
        }
        Insert: {
          ai_value_id?: string | null
          created_at?: string
          id?: string
          measure: string
          measured_on: string
          source?: string
          unit: string
          user_id: string
          value: number
          value2?: number | null
        }
        Update: {
          ai_value_id?: string | null
          created_at?: string
          id?: string
          measure?: string
          measured_on?: string
          source?: string
          unit?: string
          user_id?: string
          value?: number
          value2?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "member_reported_values_ai_value_id_fkey"
            columns: ["ai_value_id"]
            isOneToOne: true
            referencedRelation: "member_upload_ai_values"
            referencedColumns: ["id"]
          },
        ]
      }
      member_safety_audit: {
        Row: {
          action: string
          actor_id: string | null
          actor_role: string
          created_at: string
          hold_id: string
          id: number
          member_id: string
          note: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_role: string
          created_at?: string
          hold_id: string
          id?: never
          member_id: string
          note?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_role?: string
          created_at?: string
          hold_id?: string
          id?: never
          member_id?: string
          note?: string | null
        }
        Relationships: []
      }
      member_safety_holds: {
        Row: {
          assessment_id: string | null
          assessment_revision: number | null
          clear_note: string | null
          cleared_at: string | null
          cleared_by: string | null
          cleared_by_role: string | null
          expires_at: string | null
          hidden_on: string | null
          id: string
          kind: string
          member_id: string
          reviewed_at: string | null
          reviewed_by: string | null
          source_field: string
          source_value: string
          started_at: string
        }
        Insert: {
          assessment_id?: string | null
          assessment_revision?: number | null
          clear_note?: string | null
          cleared_at?: string | null
          cleared_by?: string | null
          cleared_by_role?: string | null
          expires_at?: string | null
          hidden_on?: string | null
          id?: string
          kind: string
          member_id: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_field: string
          source_value: string
          started_at?: string
        }
        Update: {
          assessment_id?: string | null
          assessment_revision?: number | null
          clear_note?: string | null
          cleared_at?: string | null
          cleared_by?: string | null
          cleared_by_role?: string | null
          expires_at?: string | null
          hidden_on?: string | null
          id?: string
          kind?: string
          member_id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_field?: string
          source_value?: string
          started_at?: string
        }
        Relationships: []
      }
      member_safety_settings: {
        Row: {
          enabled: boolean
          singleton: boolean
          updated_at: string
        }
        Insert: {
          enabled?: boolean
          singleton?: boolean
          updated_at?: string
        }
        Update: {
          enabled?: boolean
          singleton?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      member_statements: {
        Row: {
          created_at: string
          id: string
          kind: string
          member_id: string
          run_id: string
          subject: string
          words: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind?: string
          member_id: string
          run_id: string
          subject: string
          words: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          member_id?: string
          run_id?: string
          subject?: string
          words?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_statements_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "zoe_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      member_upload_ai_confirmations: {
        Row: {
          created_at: string
          identity_answer: string | null
          identity_status: string
          job_id: string
          measured_on: string | null
          member_id: string
          submission_id: string
          values_charted: number
          values_saved: number
        }
        Insert: {
          created_at?: string
          identity_answer?: string | null
          identity_status: string
          job_id: string
          measured_on?: string | null
          member_id: string
          submission_id: string
          values_charted: number
          values_saved: number
        }
        Update: {
          created_at?: string
          identity_answer?: string | null
          identity_status?: string
          job_id?: string
          measured_on?: string | null
          member_id?: string
          submission_id?: string
          values_charted?: number
          values_saved?: number
        }
        Relationships: [
          {
            foreignKeyName: "member_upload_ai_confirmations_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "lab_ai_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      member_upload_ai_edits: {
        Row: {
          action: string
          after: Json
          before: Json
          created_at: string
          id: number
          job_id: string
          member_id: string
          submission_id: string
          value_id: string
        }
        Insert: {
          action: string
          after: Json
          before: Json
          created_at?: string
          id?: never
          job_id: string
          member_id: string
          submission_id: string
          value_id: string
        }
        Update: {
          action?: string
          after?: Json
          before?: Json
          created_at?: string
          id?: never
          job_id?: string
          member_id?: string
          submission_id?: string
          value_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_upload_ai_edits_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "lab_ai_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_upload_ai_edits_value_id_fkey"
            columns: ["value_id"]
            isOneToOne: false
            referencedRelation: "member_upload_ai_values"
            referencedColumns: ["id"]
          },
        ]
      }
      member_upload_ai_values: {
        Row: {
          attention: string | null
          attention_rule: string | null
          catalogue_ref: string | null
          checks: string[]
          collected_on: string | null
          created_at: string
          document_id: string
          id: string
          job_id: string
          lab_flag: string | null
          lab_name: string | null
          measure: string | null
          measure_unit: string | null
          member_id: string
          member_reviewed_at: string | null
          member_status: string
          member_value: number | null
          page: number
          ref_high: number | null
          ref_low: number | null
          ref_text: string | null
          seq: number
          snippet: string | null
          source: string
          test_name: string
          unit: string | null
          value: number | null
          value_text: string
        }
        Insert: {
          attention?: string | null
          attention_rule?: string | null
          catalogue_ref?: string | null
          checks?: string[]
          collected_on?: string | null
          created_at?: string
          document_id: string
          id?: string
          job_id: string
          lab_flag?: string | null
          lab_name?: string | null
          measure?: string | null
          measure_unit?: string | null
          member_id: string
          member_reviewed_at?: string | null
          member_status?: string
          member_value?: number | null
          page: number
          ref_high?: number | null
          ref_low?: number | null
          ref_text?: string | null
          seq: number
          snippet?: string | null
          source?: string
          test_name: string
          unit?: string | null
          value?: number | null
          value_text: string
        }
        Update: {
          attention?: string | null
          attention_rule?: string | null
          catalogue_ref?: string | null
          checks?: string[]
          collected_on?: string | null
          created_at?: string
          document_id?: string
          id?: string
          job_id?: string
          lab_flag?: string | null
          lab_name?: string | null
          measure?: string | null
          measure_unit?: string | null
          member_id?: string
          member_reviewed_at?: string | null
          member_status?: string
          member_value?: number | null
          page?: number
          ref_high?: number | null
          ref_low?: number | null
          ref_text?: string | null
          seq?: number
          snippet?: string | null
          source?: string
          test_name?: string
          unit?: string | null
          value?: number | null
          value_text?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_upload_ai_values_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "member_reported_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_upload_ai_values_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "lab_ai_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      member_upload_approved_values: {
        Row: {
          action: string
          approval_id: string
          job_id: string
          value: number | null
          value_id: string
        }
        Insert: {
          action: string
          approval_id: string
          job_id: string
          value?: number | null
          value_id: string
        }
        Update: {
          action?: string
          approval_id?: string
          job_id?: string
          value?: number | null
          value_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_upload_approved_values_approval_id_fkey"
            columns: ["approval_id"]
            isOneToOne: false
            referencedRelation: "member_upload_doctor_approvals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_upload_approved_values_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "lab_ai_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_upload_approved_values_value_id_fkey"
            columns: ["value_id"]
            isOneToOne: false
            referencedRelation: "member_upload_ai_values"
            referencedColumns: ["id"]
          },
        ]
      }
      member_upload_doctor_approvals: {
        Row: {
          changes: Json
          command_hash: string | null
          created_at: string
          doctor_id: string
          document_id: string
          id: string
          interpretation_edited: boolean
          interpretation_en: string
          interpretation_hy: string
          job_id: string
          member_id: string
          submission_id: string
          version: number
        }
        Insert: {
          changes: Json
          command_hash?: string | null
          created_at?: string
          doctor_id: string
          document_id: string
          id?: string
          interpretation_edited: boolean
          interpretation_en: string
          interpretation_hy: string
          job_id: string
          member_id: string
          submission_id: string
          version: number
        }
        Update: {
          changes?: Json
          command_hash?: string | null
          created_at?: string
          doctor_id?: string
          document_id?: string
          id?: string
          interpretation_edited?: boolean
          interpretation_en?: string
          interpretation_hy?: string
          job_id?: string
          member_id?: string
          submission_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "member_upload_doctor_approvals_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "member_reported_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_upload_doctor_approvals_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "lab_ai_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      multi_medicine_capabilities: {
        Row: {
          enabled: boolean
          singleton: boolean
          updated_at: string
        }
        Insert: {
          enabled?: boolean
          singleton?: boolean
          updated_at?: string
        }
        Update: {
          enabled?: boolean
          singleton?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      native_member_request_usage: {
        Row: {
          day_count: number
          day_started_at: string
          minute_count: number
          minute_started_at: string
          user_id: string
        }
        Insert: {
          day_count: number
          day_started_at: string
          minute_count: number
          minute_started_at: string
          user_id: string
        }
        Update: {
          day_count?: number
          day_started_at?: string
          minute_count?: number
          minute_started_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notice_channels: {
        Row: {
          audience: string
          chat: boolean
          push: boolean
          telegram: boolean
          template_id: string
          updated_at: string
        }
        Insert: {
          audience?: string
          chat?: boolean
          push?: boolean
          telegram?: boolean
          template_id: string
          updated_at?: string
        }
        Update: {
          audience?: string
          chat?: boolean
          push?: boolean
          telegram?: boolean
          template_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      nurse_chat_settings: {
        Row: {
          enabled: boolean
          singleton: boolean
        }
        Insert: {
          enabled?: boolean
          singleton?: boolean
        }
        Update: {
          enabled?: boolean
          singleton?: boolean
        }
        Relationships: []
      }
      nurse_visit_checklist: {
        Row: {
          id: string
          label_en: string
          label_hy: string
          position: number
          requires_test: string | null
          section: string
          source: string
          version: string
        }
        Insert: {
          id: string
          label_en: string
          label_hy: string
          position: number
          requires_test?: string | null
          section: string
          source: string
          version: string
        }
        Update: {
          id?: string
          label_en?: string
          label_hy?: string
          position?: number
          requires_test?: string | null
          section?: string
          source?: string
          version?: string
        }
        Relationships: []
      }
      nurse_visit_collection_receipts: {
        Row: {
          actor_id: string
          actor_name: string
          arrangement: string
          binding_generation: number | null
          binding_id: string | null
          channel: string
          command: Json
          member_id: string
          recorded_at: string
          result: Json
          session_id: string | null
          source: string
          source_id: string
          submission_id: string
        }
        Insert: {
          actor_id: string
          actor_name: string
          arrangement: string
          binding_generation?: number | null
          binding_id?: string | null
          channel: string
          command: Json
          member_id: string
          recorded_at?: string
          result: Json
          session_id?: string | null
          source: string
          source_id: string
          submission_id: string
        }
        Update: {
          actor_id?: string
          actor_name?: string
          arrangement?: string
          binding_generation?: number | null
          binding_id?: string | null
          channel?: string
          command?: Json
          member_id?: string
          recorded_at?: string
          result?: Json
          session_id?: string | null
          source?: string
          source_id?: string
          submission_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "nurse_visit_collection_receipts_binding_id_fkey"
            columns: ["binding_id"]
            isOneToOne: false
            referencedRelation: "telegram_auth_bindings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nurse_visit_collection_receipts_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "patient_clinical_cases"
            referencedColumns: ["user_id"]
          },
        ]
      }
      nurse_visit_completions: {
        Row: {
          actor_id: string
          actor_name: string
          binding_generation: number | null
          binding_id: string | null
          channel: string
          command: Json
          completed_at: string
          id: string
          member_id: string
          reason: string | null
          result: Json
          session_id: string | null
          source: string
          source_id: string
          submission_id: string
          summary: Json
          visit_id: string
        }
        Insert: {
          actor_id: string
          actor_name: string
          binding_generation?: number | null
          binding_id?: string | null
          channel?: string
          command: Json
          completed_at?: string
          id?: string
          member_id: string
          reason?: string | null
          result: Json
          session_id?: string | null
          source: string
          source_id: string
          submission_id: string
          summary: Json
          visit_id: string
        }
        Update: {
          actor_id?: string
          actor_name?: string
          binding_generation?: number | null
          binding_id?: string | null
          channel?: string
          command?: Json
          completed_at?: string
          id?: string
          member_id?: string
          reason?: string | null
          result?: Json
          session_id?: string | null
          source?: string
          source_id?: string
          submission_id?: string
          summary?: Json
          visit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "nurse_visit_completions_binding_id_fkey"
            columns: ["binding_id"]
            isOneToOne: false
            referencedRelation: "telegram_auth_bindings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nurse_visit_completions_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "patient_clinical_cases"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "nurse_visit_completions_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: true
            referencedRelation: "patient_care_visits"
            referencedColumns: ["id"]
          },
        ]
      }
      nurse_visit_events: {
        Row: {
          actor_id: string
          actor_name: string
          actor_role: string
          arrangement: string
          id: string
          member_id: string
          occurred_at: string
          source: string
          source_id: string
          step: string
          submission_id: string
        }
        Insert: {
          actor_id: string
          actor_name: string
          actor_role: string
          arrangement: string
          id?: string
          member_id: string
          occurred_at?: string
          source: string
          source_id: string
          step: string
          submission_id: string
        }
        Update: {
          actor_id?: string
          actor_name?: string
          actor_role?: string
          arrangement?: string
          id?: string
          member_id?: string
          occurred_at?: string
          source?: string
          source_id?: string
          step?: string
          submission_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "nurse_visit_events_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "patient_clinical_cases"
            referencedColumns: ["user_id"]
          },
        ]
      }
      nurse_visit_marks: {
        Row: {
          actor_id: string
          actor_name: string
          arrangement: string | null
          checklist_version: string | null
          collection_status: string | null
          done: boolean
          id: string
          item: string
          member_id: string
          note: string | null
          recorded_at: string
          source: string
          source_id: string
          submission_id: string
          vals: Json | null
        }
        Insert: {
          actor_id: string
          actor_name: string
          arrangement?: string | null
          checklist_version?: string | null
          collection_status?: string | null
          done: boolean
          id?: string
          item: string
          member_id: string
          note?: string | null
          recorded_at?: string
          source: string
          source_id: string
          submission_id: string
          vals?: Json | null
        }
        Update: {
          actor_id?: string
          actor_name?: string
          arrangement?: string | null
          checklist_version?: string | null
          collection_status?: string | null
          done?: boolean
          id?: string
          item?: string
          member_id?: string
          note?: string | null
          recorded_at?: string
          source?: string
          source_id?: string
          submission_id?: string
          vals?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "nurse_visit_marks_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "patient_clinical_cases"
            referencedColumns: ["user_id"]
          },
        ]
      }
      nurse_visit_settings: {
        Row: {
          checklist_version: string
          enabled: boolean
          singleton: boolean
          updated_at: string
        }
        Insert: {
          checklist_version?: string
          enabled?: boolean
          singleton?: boolean
          updated_at?: string
        }
        Update: {
          checklist_version?: string
          enabled?: boolean
          singleton?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      patient_assessments: {
        Row: {
          algorithm_version: string
          answer_sources: Json
          answers: Json
          assessment_date: string
          completed_at: string | null
          id: string
          revision: number
          updated_at: string
          urgent_rule: string | null
          user_id: string
        }
        Insert: {
          algorithm_version?: string
          answer_sources?: Json
          answers?: Json
          assessment_date?: string
          completed_at?: string | null
          id?: string
          revision?: number
          updated_at?: string
          urgent_rule?: string | null
          user_id: string
        }
        Update: {
          algorithm_version?: string
          answer_sources?: Json
          answers?: Json
          assessment_date?: string
          completed_at?: string | null
          id?: string
          revision?: number
          updated_at?: string
          urgent_rule?: string | null
          user_id?: string
        }
        Relationships: []
      }
      patient_care_appointments: {
        Row: {
          clinician: string | null
          id: string
          location: string | null
          specialty: string
          starts_at: string | null
          status: string
          user_id: string
        }
        Insert: {
          clinician?: string | null
          id?: string
          location?: string | null
          specialty: string
          starts_at?: string | null
          status: string
          user_id: string
        }
        Update: {
          clinician?: string | null
          id?: string
          location?: string | null
          specialty?: string
          starts_at?: string | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      patient_care_lab_stages: {
        Row: {
          actor_id: string | null
          actor_name: string
          actor_role: string
          attachment_id: string | null
          clinic_id: string
          collection_entry_id: string
          id: string
          occurred_at: string
          recorded_at: string
          retracts: string | null
          stage: string
          submission_id: string
          user_id: string
        }
        Insert: {
          actor_id?: string | null
          actor_name: string
          actor_role: string
          attachment_id?: string | null
          clinic_id: string
          collection_entry_id: string
          id?: string
          occurred_at: string
          recorded_at?: string
          retracts?: string | null
          stage: string
          submission_id: string
          user_id: string
        }
        Update: {
          actor_id?: string | null
          actor_name?: string
          actor_role?: string
          attachment_id?: string | null
          clinic_id?: string
          collection_entry_id?: string
          id?: string
          occurred_at?: string
          recorded_at?: string
          retracts?: string | null
          stage?: string
          submission_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_care_lab_stages_attachment_id_fkey"
            columns: ["attachment_id"]
            isOneToOne: false
            referencedRelation: "clinic_result_attachments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_care_lab_stages_collection_entry_id_fkey"
            columns: ["collection_entry_id"]
            isOneToOne: false
            referencedRelation: "patient_care_visit_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_care_lab_stages_retracts_fkey"
            columns: ["retracts"]
            isOneToOne: true
            referencedRelation: "patient_care_lab_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_care_lab_stages_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "patient_clinical_cases"
            referencedColumns: ["user_id"]
          },
        ]
      }
      patient_care_medications: {
        Row: {
          active: boolean
          dose: string
          effective_at: string | null
          end_date: string | null
          id: string
          instructions: string
          name: string
          plan_id: string
          start_date: string
          times: string[]
          user_id: string
        }
        Insert: {
          active?: boolean
          dose: string
          effective_at?: string | null
          end_date?: string | null
          id?: string
          instructions: string
          name: string
          plan_id: string
          start_date: string
          times: string[]
          user_id: string
        }
        Update: {
          active?: boolean
          dose?: string
          effective_at?: string | null
          end_date?: string | null
          id?: string
          instructions?: string
          name?: string
          plan_id?: string
          start_date?: string
          times?: string[]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_care_medications_plan_id_user_id_fkey"
            columns: ["plan_id", "user_id"]
            isOneToOne: false
            referencedRelation: "patient_care_plans"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      patient_care_plan_medications: {
        Row: {
          medication_id: string
          plan_id: string
          user_id: string
        }
        Insert: {
          medication_id: string
          plan_id: string
          user_id: string
        }
        Update: {
          medication_id?: string
          plan_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_care_plan_medications_medication_id_user_id_fkey"
            columns: ["medication_id", "user_id"]
            isOneToOne: false
            referencedRelation: "patient_care_medications"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "patient_care_plan_medications_plan_id_user_id_fkey"
            columns: ["plan_id", "user_id"]
            isOneToOne: false
            referencedRelation: "patient_care_plans"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      patient_care_plan_regimens: {
        Row: {
          changes: Json
          created_at: string
          medicines: Json
          plan_id: string
          previous_plan_id: string | null
          user_id: string
        }
        Insert: {
          changes: Json
          created_at?: string
          medicines: Json
          plan_id: string
          previous_plan_id?: string | null
          user_id: string
        }
        Update: {
          changes?: Json
          created_at?: string
          medicines?: Json
          plan_id?: string
          previous_plan_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_care_plan_regimens_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: true
            referencedRelation: "patient_clinical_publications"
            referencedColumns: ["plan_id"]
          },
          {
            foreignKeyName: "patient_care_plan_regimens_previous_plan_id_fkey"
            columns: ["previous_plan_id"]
            isOneToOne: false
            referencedRelation: "patient_clinical_publications"
            referencedColumns: ["plan_id"]
          },
        ]
      }
      patient_care_plan_versions: {
        Row: {
          change_summary: string | null
          created_at: string
          plan_id: string
          previous_plan_id: string | null
          teach_back_confirmed_at: string | null
          user_id: string
          version: number
        }
        Insert: {
          change_summary?: string | null
          created_at?: string
          plan_id: string
          previous_plan_id?: string | null
          teach_back_confirmed_at?: string | null
          user_id: string
          version: number
        }
        Update: {
          change_summary?: string | null
          created_at?: string
          plan_id?: string
          previous_plan_id?: string | null
          teach_back_confirmed_at?: string | null
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "patient_care_plan_versions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: true
            referencedRelation: "patient_clinical_publications"
            referencedColumns: ["plan_id"]
          },
          {
            foreignKeyName: "patient_care_plan_versions_previous_plan_id_fkey"
            columns: ["previous_plan_id"]
            isOneToOne: false
            referencedRelation: "patient_clinical_publications"
            referencedColumns: ["plan_id"]
          },
        ]
      }
      patient_care_plans: {
        Row: {
          acknowledged_at: string | null
          active: boolean
          clinician: string
          id: string
          instructions: string
          published_at: string
          retired_at: string | null
          user_id: string
        }
        Insert: {
          acknowledged_at?: string | null
          active?: boolean
          clinician: string
          id?: string
          instructions: string
          published_at?: string
          retired_at?: string | null
          user_id: string
        }
        Update: {
          acknowledged_at?: string | null
          active?: boolean
          clinician?: string
          id?: string
          instructions?: string
          published_at?: string
          retired_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      patient_care_results: {
        Row: {
          collected_at: string
          explanation: string | null
          id: string
          marker: string
          publication_plan_id: string | null
          received_at: string
          reference_high: number | null
          reference_low: number | null
          reference_text: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          source: string
          source_lab_reviewed_at: string | null
          source_lab_value_id: string | null
          source_label: string
          source_report_id: string | null
          source_revision: number | null
          source_row: number | null
          test_id: string | null
          unit: string
          user_id: string
          value: number
        }
        Insert: {
          collected_at: string
          explanation?: string | null
          id?: string
          marker: string
          publication_plan_id?: string | null
          received_at: string
          reference_high?: number | null
          reference_low?: number | null
          reference_text?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source: string
          source_lab_reviewed_at?: string | null
          source_lab_value_id?: string | null
          source_label: string
          source_report_id?: string | null
          source_revision?: number | null
          source_row?: number | null
          test_id?: string | null
          unit: string
          user_id: string
          value: number
        }
        Update: {
          collected_at?: string
          explanation?: string | null
          id?: string
          marker?: string
          publication_plan_id?: string | null
          received_at?: string
          reference_high?: number | null
          reference_low?: number | null
          reference_text?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source?: string
          source_lab_reviewed_at?: string | null
          source_lab_value_id?: string | null
          source_label?: string
          source_report_id?: string | null
          source_revision?: number | null
          source_row?: number | null
          test_id?: string | null
          unit?: string
          user_id?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "patient_care_results_publication_plan_owner_fkey"
            columns: ["publication_plan_id", "user_id"]
            isOneToOne: false
            referencedRelation: "patient_care_plans"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "patient_care_results_source_lab_value_id_fkey"
            columns: ["source_lab_value_id"]
            isOneToOne: false
            referencedRelation: "lab_ai_values"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_care_results_source_report_id_fkey"
            columns: ["source_report_id"]
            isOneToOne: false
            referencedRelation: "patient_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_care_results_test_id_user_id_fkey"
            columns: ["test_id", "user_id"]
            isOneToOne: false
            referencedRelation: "patient_care_tests"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      patient_care_tests: {
        Row: {
          due_at: string | null
          id: string
          location: string | null
          ordered_at: string
          ordered_by: string
          preparation: string | null
          source: string
          source_lab_attachment_id: string | null
          source_label: string
          source_report_id: string | null
          source_requirement_id: string | null
          status: string
          title: string
          user_id: string
        }
        Insert: {
          due_at?: string | null
          id?: string
          location?: string | null
          ordered_at: string
          ordered_by: string
          preparation?: string | null
          source: string
          source_lab_attachment_id?: string | null
          source_label: string
          source_report_id?: string | null
          source_requirement_id?: string | null
          status: string
          title: string
          user_id: string
        }
        Update: {
          due_at?: string | null
          id?: string
          location?: string | null
          ordered_at?: string
          ordered_by?: string
          preparation?: string | null
          source?: string
          source_lab_attachment_id?: string | null
          source_label?: string
          source_report_id?: string | null
          source_requirement_id?: string | null
          status?: string
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_care_tests_source_lab_attachment_id_fkey"
            columns: ["source_lab_attachment_id"]
            isOneToOne: false
            referencedRelation: "clinic_result_attachments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_care_tests_source_report_id_fkey"
            columns: ["source_report_id"]
            isOneToOne: false
            referencedRelation: "patient_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_care_visit_command_receipts: {
        Row: {
          actor_id: string
          binding_generation: number | null
          binding_id: string | null
          channel: string
          command: Json
          recorded_at: string
          result: Json | null
          session_id: string | null
          state: string
          submission_id: string
          user_id: string
        }
        Insert: {
          actor_id: string
          binding_generation?: number | null
          binding_id?: string | null
          channel?: string
          command: Json
          recorded_at?: string
          result?: Json | null
          session_id?: string | null
          state: string
          submission_id: string
          user_id: string
        }
        Update: {
          actor_id?: string
          binding_generation?: number | null
          binding_id?: string | null
          channel?: string
          command?: Json
          recorded_at?: string
          result?: Json | null
          session_id?: string | null
          state?: string
          submission_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_care_visit_command_receipts_binding_id_fkey"
            columns: ["binding_id"]
            isOneToOne: false
            referencedRelation: "telegram_auth_bindings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_care_visit_command_receipts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "patient_clinical_cases"
            referencedColumns: ["user_id"]
          },
        ]
      }
      patient_care_visit_entries: {
        Row: {
          actor_id: string
          actor_name: string
          actor_role: string
          clinic_id: string
          id: string
          measurement_id: string | null
          observed_at: string
          observed_instant: string
          payload: Json
          position: number
          recorded_at: string
          source: string
          submission_id: string
          user_id: string
          visit_id: string
        }
        Insert: {
          actor_id: string
          actor_name: string
          actor_role: string
          clinic_id: string
          id?: string
          measurement_id?: string | null
          observed_at: string
          observed_instant: string
          payload: Json
          position: number
          recorded_at?: string
          source?: string
          submission_id: string
          user_id: string
          visit_id: string
        }
        Update: {
          actor_id?: string
          actor_name?: string
          actor_role?: string
          clinic_id?: string
          id?: string
          measurement_id?: string | null
          observed_at?: string
          observed_instant?: string
          payload?: Json
          position?: number
          recorded_at?: string
          source?: string
          submission_id?: string
          user_id?: string
          visit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_care_visit_entries_measurement_id_fkey"
            columns: ["measurement_id"]
            isOneToOne: false
            referencedRelation: "patient_measurements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_care_visit_entries_user_id_submission_id_fkey"
            columns: ["user_id", "submission_id"]
            isOneToOne: false
            referencedRelation: "patient_care_visit_command_receipts"
            referencedColumns: ["user_id", "submission_id"]
          },
          {
            foreignKeyName: "patient_care_visit_entries_user_id_visit_id_fkey"
            columns: ["user_id", "visit_id"]
            isOneToOne: false
            referencedRelation: "patient_care_visits"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      patient_care_visits: {
        Row: {
          accepted_revision: number | null
          actor_id: string
          actor_name: string
          actor_role: string
          appointment_id: string | null
          booking_context: Json | null
          clinic_id: string
          created_at: string
          id: string
          source: string
          user_id: string
        }
        Insert: {
          accepted_revision?: number | null
          actor_id: string
          actor_name: string
          actor_role: string
          appointment_id?: string | null
          booking_context?: Json | null
          clinic_id: string
          created_at?: string
          id: string
          source?: string
          user_id: string
        }
        Update: {
          accepted_revision?: number | null
          actor_id?: string
          actor_name?: string
          actor_role?: string
          appointment_id?: string | null
          booking_context?: Json | null
          clinic_id?: string
          created_at?: string
          id?: string
          source?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_care_visits_appointment_id_accepted_revision_fkey"
            columns: ["appointment_id", "accepted_revision"]
            isOneToOne: false
            referencedRelation: "booking_appointment_versions"
            referencedColumns: ["appointment_id", "revision"]
          },
          {
            foreignKeyName: "patient_care_visits_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "patient_clinical_cases"
            referencedColumns: ["user_id"]
          },
        ]
      }
      patient_clinical_case_events: {
        Row: {
          actor_id: string
          created_at: string
          detail: Json
          id: number
          kind: string
          revision: number
          user_id: string
        }
        Insert: {
          actor_id: string
          created_at?: string
          detail?: Json
          id?: never
          kind: string
          revision: number
          user_id: string
        }
        Update: {
          actor_id?: string
          created_at?: string
          detail?: Json
          id?: never
          kind?: string
          revision?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_clinical_case_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "patient_clinical_cases"
            referencedColumns: ["user_id"]
          },
        ]
      }
      patient_clinical_cases: {
        Row: {
          assigned_doctor_id: string | null
          assigned_nurse_id: string | null
          created_at: string
          draft: Json | null
          draft_evidence_token: string | null
          draft_lab_token: string | null
          draft_review_token: string | null
          draft_saved_at: string | null
          draft_saved_by: string | null
          review: Json | null
          revision: number
          updated_at: string
          user_id: string
        }
        Insert: {
          assigned_doctor_id?: string | null
          assigned_nurse_id?: string | null
          created_at?: string
          draft?: Json | null
          draft_evidence_token?: string | null
          draft_lab_token?: string | null
          draft_review_token?: string | null
          draft_saved_at?: string | null
          draft_saved_by?: string | null
          review?: Json | null
          revision?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          assigned_doctor_id?: string | null
          assigned_nurse_id?: string | null
          created_at?: string
          draft?: Json | null
          draft_evidence_token?: string | null
          draft_lab_token?: string | null
          draft_review_token?: string | null
          draft_saved_at?: string | null
          draft_saved_by?: string | null
          review?: Json | null
          revision?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_clinical_cases_assigned_doctor_id_fkey"
            columns: ["assigned_doctor_id"]
            isOneToOne: false
            referencedRelation: "workspace_staff"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "patient_clinical_cases_assigned_nurse_id_fkey"
            columns: ["assigned_nurse_id"]
            isOneToOne: false
            referencedRelation: "workspace_staff"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "patient_clinical_cases_draft_saved_by_fkey"
            columns: ["draft_saved_by"]
            isOneToOne: false
            referencedRelation: "workspace_staff"
            referencedColumns: ["user_id"]
          },
        ]
      }
      patient_clinical_publications: {
        Row: {
          actor_id: string
          case_revision: number
          draft: Json
          evidence: Json
          evidence_token: string
          id: string
          plan_id: string
          published_at: string
          request_id: string
          review: Json
          user_id: string
        }
        Insert: {
          actor_id: string
          case_revision: number
          draft: Json
          evidence: Json
          evidence_token: string
          id?: string
          plan_id: string
          published_at?: string
          request_id: string
          review: Json
          user_id: string
        }
        Update: {
          actor_id?: string
          case_revision?: number
          draft?: Json
          evidence?: Json
          evidence_token?: string
          id?: string
          plan_id?: string
          published_at?: string
          request_id?: string
          review?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_clinical_publications_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "workspace_staff"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "patient_clinical_publications_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: true
            referencedRelation: "patient_care_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_consents: {
        Row: {
          accepted_at: string
          user_id: string
          version: string
        }
        Insert: {
          accepted_at?: string
          user_id: string
          version: string
        }
        Update: {
          accepted_at?: string
          user_id?: string
          version?: string
        }
        Relationships: []
      }
      patient_consultation_arrangements: {
        Row: {
          actor_id: string
          channel: string
          clinic_id: string | null
          created_at: string
          hold_since: string
          id: string
          scheduled_at: string
          submission_id: string
          user_id: string
        }
        Insert: {
          actor_id: string
          channel: string
          clinic_id?: string | null
          created_at?: string
          hold_since: string
          id?: string
          scheduled_at: string
          submission_id: string
          user_id: string
        }
        Update: {
          actor_id?: string
          channel?: string
          clinic_id?: string | null
          created_at?: string
          hold_since?: string
          id?: string
          scheduled_at?: string
          submission_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_consultation_arrangements_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "workspace_clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_consultation_arrangements_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "patient_clinical_cases"
            referencedColumns: ["user_id"]
          },
        ]
      }
      patient_coordination_events: {
        Row: {
          actor_id: string
          actor_name: string
          actor_role: string
          care_note_id: string | null
          created_at: string
          detail: Json
          id: number
          new_owner_id: string
          new_status: string
          note: string
          old_owner_id: string | null
          old_status: string | null
          operation: string
          request_id: string
          revision: number
          task_id: string
        }
        Insert: {
          actor_id: string
          actor_name: string
          actor_role: string
          care_note_id?: string | null
          created_at?: string
          detail?: Json
          id?: never
          new_owner_id: string
          new_status: string
          note?: string
          old_owner_id?: string | null
          old_status?: string | null
          operation: string
          request_id: string
          revision: number
          task_id: string
        }
        Update: {
          actor_id?: string
          actor_name?: string
          actor_role?: string
          care_note_id?: string | null
          created_at?: string
          detail?: Json
          id?: never
          new_owner_id?: string
          new_status?: string
          note?: string
          old_owner_id?: string | null
          old_status?: string | null
          operation?: string
          request_id?: string
          revision?: number
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_coordination_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "workspace_staff"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "patient_coordination_events_care_note_id_fkey"
            columns: ["care_note_id"]
            isOneToOne: false
            referencedRelation: "staff_care_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_coordination_events_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "patient_coordination_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_coordination_receipts: {
        Row: {
          actor_id: string
          binding_generation: number | null
          binding_id: string | null
          channel: string
          created_at: string
          input: Json
          patient_case_id: string
          request_id: string
          result: Json
          session_id: string | null
        }
        Insert: {
          actor_id: string
          binding_generation?: number | null
          binding_id?: string | null
          channel?: string
          created_at?: string
          input: Json
          patient_case_id: string
          request_id: string
          result: Json
          session_id?: string | null
        }
        Update: {
          actor_id?: string
          binding_generation?: number | null
          binding_id?: string | null
          channel?: string
          created_at?: string
          input?: Json
          patient_case_id?: string
          request_id?: string
          result?: Json
          session_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "patient_coordination_receipts_binding_id_fkey"
            columns: ["binding_id"]
            isOneToOne: false
            referencedRelation: "telegram_auth_bindings"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_coordination_tasks: {
        Row: {
          created_at: string
          creator_id: string
          due_at: string | null
          id: string
          instructions: string
          kind: string
          origin: string | null
          owner_id: string
          patient_case_id: string
          revision: number
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          creator_id: string
          due_at?: string | null
          id: string
          instructions: string
          kind: string
          origin?: string | null
          owner_id: string
          patient_case_id: string
          revision?: number
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          creator_id?: string
          due_at?: string | null
          id?: string
          instructions?: string
          kind?: string
          origin?: string | null
          owner_id?: string
          patient_case_id?: string
          revision?: number
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_coordination_tasks_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "workspace_staff"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "patient_coordination_tasks_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "workspace_staff"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "patient_coordination_tasks_patient_case_id_fkey"
            columns: ["patient_case_id"]
            isOneToOne: false
            referencedRelation: "patient_clinical_cases"
            referencedColumns: ["user_id"]
          },
        ]
      }
      patient_document_opens: {
        Row: {
          actor_id: string
          actor_kind: string
          attachment_id: string
          created_at: string
          file_id: string
          id: number
          session_id: string | null
          user_id: string
        }
        Insert: {
          actor_id: string
          actor_kind: string
          attachment_id: string
          created_at?: string
          file_id: string
          id?: never
          session_id?: string | null
          user_id: string
        }
        Update: {
          actor_id?: string
          actor_kind?: string
          attachment_id?: string
          created_at?: string
          file_id?: string
          id?: never
          session_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_document_opens_attachment_id_fkey"
            columns: ["attachment_id"]
            isOneToOne: false
            referencedRelation: "clinic_result_attachments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_document_opens_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "clinic_batch_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_document_opens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "patient_clinical_cases"
            referencedColumns: ["user_id"]
          },
        ]
      }
      patient_document_release_events: {
        Row: {
          actor_id: string
          attachment_id: string
          created_at: string
          file_id: string
          id: string
          kind: string
          seq: number
          single_member_confirmed: boolean
          submission_id: string
          user_id: string
        }
        Insert: {
          actor_id: string
          attachment_id: string
          created_at?: string
          file_id: string
          id?: string
          kind: string
          seq?: never
          single_member_confirmed?: boolean
          submission_id: string
          user_id: string
        }
        Update: {
          actor_id?: string
          attachment_id?: string
          created_at?: string
          file_id?: string
          id?: string
          kind?: string
          seq?: never
          single_member_confirmed?: boolean
          submission_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_document_release_events_attachment_id_fkey"
            columns: ["attachment_id"]
            isOneToOne: false
            referencedRelation: "clinic_result_attachments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_document_release_events_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "clinic_batch_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_document_release_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "patient_clinical_cases"
            referencedColumns: ["user_id"]
          },
        ]
      }
      patient_dose_event_history: {
        Row: {
          due_at: string
          kind: string
          medication_id: string
          plan_id: string | null
          recorded_at: string
          recorded_by: string | null
          revision: number
          status: string
          user_id: string
        }
        Insert: {
          due_at: string
          kind: string
          medication_id: string
          plan_id?: string | null
          recorded_at: string
          recorded_by?: string | null
          revision: number
          status: string
          user_id: string
        }
        Update: {
          due_at?: string
          kind?: string
          medication_id?: string
          plan_id?: string | null
          recorded_at?: string
          recorded_by?: string | null
          revision?: number
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_dose_event_history_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "patient_care_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_dose_event_history_user_id_medication_id_due_at_fkey"
            columns: ["user_id", "medication_id", "due_at"]
            isOneToOne: false
            referencedRelation: "patient_dose_events"
            referencedColumns: ["user_id", "medication_id", "due_at"]
          },
        ]
      }
      patient_dose_events: {
        Row: {
          due_at: string
          medication_id: string
          recorded_at: string
          revision: number
          status: string
          user_id: string
        }
        Insert: {
          due_at: string
          medication_id: string
          recorded_at?: string
          revision?: number
          status: string
          user_id: string
        }
        Update: {
          due_at?: string
          medication_id?: string
          recorded_at?: string
          revision?: number
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_dose_events_medication_id_user_id_fkey"
            columns: ["medication_id", "user_id"]
            isOneToOne: false
            referencedRelation: "patient_care_medications"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      patient_investigation_records: {
        Row: {
          finding: string | null
          id: string
          performed_on: string
          recorded_at: string
          recorded_by: string
          recorded_by_name: string
          result: string
          source: string
          test_id: string
          user_id: string
        }
        Insert: {
          finding?: string | null
          id?: string
          performed_on: string
          recorded_at?: string
          recorded_by: string
          recorded_by_name: string
          result: string
          source: string
          test_id: string
          user_id: string
        }
        Update: {
          finding?: string | null
          id?: string
          performed_on?: string
          recorded_at?: string
          recorded_by?: string
          recorded_by_name?: string
          result?: string
          source?: string
          test_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_investigation_records_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "workspace_staff"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "patient_investigation_records_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "patient_clinical_cases"
            referencedColumns: ["user_id"]
          },
        ]
      }
      patient_measurements: {
        Row: {
          created_at: string
          diastolic: number
          entry_source: string | null
          id: string
          measured_at: string
          pulse: number | null
          source: string
          submission_id: string
          systolic: number
          user_id: string
          zone: string | null
          zone_rule_version: string | null
        }
        Insert: {
          created_at?: string
          diastolic: number
          entry_source?: string | null
          id?: string
          measured_at: string
          pulse?: number | null
          source?: string
          submission_id: string
          systolic: number
          user_id: string
          zone?: string | null
          zone_rule_version?: string | null
        }
        Update: {
          created_at?: string
          diastolic?: number
          entry_source?: string | null
          id?: string
          measured_at?: string
          pulse?: number | null
          source?: string
          submission_id?: string
          systolic?: number
          user_id?: string
          zone?: string | null
          zone_rule_version?: string | null
        }
        Relationships: []
      }
      patient_message_attempts: {
        Row: {
          channel: string
          id: string
          job_id: string | null
          last_polled_status: string | null
          next_reconcile_at: string
          provider_reference: string | null
          reconcile_failures: number
          stable_polls: number
          started_at: string
          status: string
          template_key: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          channel: string
          id?: string
          job_id?: string | null
          last_polled_status?: string | null
          next_reconcile_at?: string
          provider_reference?: string | null
          reconcile_failures?: number
          stable_polls?: number
          started_at?: string
          status?: string
          template_key: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          channel?: string
          id?: string
          job_id?: string | null
          last_polled_status?: string | null
          next_reconcile_at?: string
          provider_reference?: string | null
          reconcile_failures?: number
          stable_polls?: number
          started_at?: string
          status?: string
          template_key?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "patient_message_attempts_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "patient_message_outbox"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_message_consent_events: {
        Row: {
          channel: string
          consent_version: string
          created_at: string
          id: number
          phone_fingerprint: string | null
          revision: number
          user_id: string
        }
        Insert: {
          channel: string
          consent_version: string
          created_at?: string
          id?: never
          phone_fingerprint?: string | null
          revision: number
          user_id: string
        }
        Update: {
          channel?: string
          consent_version?: string
          created_at?: string
          id?: never
          phone_fingerprint?: string | null
          revision?: number
          user_id?: string
        }
        Relationships: []
      }
      patient_message_control_events: {
        Row: {
          action: string
          created_at: string
          daily_limit: number
          reason: string
          revision: number
        }
        Insert: {
          action: string
          created_at?: string
          daily_limit: number
          reason: string
          revision: number
        }
        Update: {
          action?: string
          created_at?: string
          daily_limit?: number
          reason?: string
          revision?: number
        }
        Relationships: []
      }
      patient_message_delivery_events: {
        Row: {
          attempt_id: string
          error_code: string
          id: number
          received_at: string
          status: string
        }
        Insert: {
          attempt_id: string
          error_code?: string
          id?: never
          received_at?: string
          status: string
        }
        Update: {
          attempt_id?: string
          error_code?: string
          id?: never
          received_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_message_delivery_events_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "patient_message_attempts"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_message_dispatch_control: {
        Row: {
          budget_day: string
          daily_limit: number
          id: number
          paused_at: string | null
          paused_reason: string | null
          revision: number
          started_count: number
        }
        Insert: {
          budget_day?: string
          daily_limit?: number
          id?: number
          paused_at?: string | null
          paused_reason?: string | null
          revision?: number
          started_count?: number
        }
        Update: {
          budget_day?: string
          daily_limit?: number
          id?: number
          paused_at?: string | null
          paused_reason?: string | null
          revision?: number
          started_count?: number
        }
        Relationships: []
      }
      patient_message_outbox: {
        Row: {
          cancellation_policy_revision: number | null
          cancellation_reason: string | null
          cancelled_at: string | null
          channel: string
          consent_revision: number
          created_at: string
          expires_at: string
          id: string
          kind: string
          plan_id: string
          state: string
          template_key: string
          user_id: string
        }
        Insert: {
          cancellation_policy_revision?: number | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          channel: string
          consent_revision: number
          created_at?: string
          expires_at: string
          id?: string
          kind?: string
          plan_id: string
          state?: string
          template_key?: string
          user_id: string
        }
        Update: {
          cancellation_policy_revision?: number | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          channel?: string
          consent_revision?: number
          created_at?: string
          expires_at?: string
          id?: string
          kind?: string
          plan_id?: string
          state?: string
          template_key?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_message_outbox_cancellation_policy_revision_fkey"
            columns: ["cancellation_policy_revision"]
            isOneToOne: false
            referencedRelation: "patient_message_spend_policy_events"
            referencedColumns: ["revision"]
          },
          {
            foreignKeyName: "patient_message_outbox_plan_id_user_id_fkey"
            columns: ["plan_id", "user_id"]
            isOneToOne: false
            referencedRelation: "patient_care_plans"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      patient_message_preferences: {
        Row: {
          channel: string
          consent_version: string
          consented_at: string | null
          revision: number
          updated_at: string
          user_id: string
          verified_phone: string | null
        }
        Insert: {
          channel: string
          consent_version: string
          consented_at?: string | null
          revision: number
          updated_at?: string
          user_id: string
          verified_phone?: string | null
        }
        Update: {
          channel?: string
          consent_version?: string
          consented_at?: string | null
          revision?: number
          updated_at?: string
          user_id?: string
          verified_phone?: string | null
        }
        Relationships: []
      }
      patient_message_recovery_events: {
        Row: {
          action: string
          attempt_id: string | null
          control_revision: number | null
          created_at: string
          evidence: string | null
          id: string
          operator_label: string
        }
        Insert: {
          action: string
          attempt_id?: string | null
          control_revision?: number | null
          created_at?: string
          evidence?: string | null
          id?: string
          operator_label: string
        }
        Update: {
          action?: string
          attempt_id?: string | null
          control_revision?: number | null
          created_at?: string
          evidence?: string | null
          id?: string
          operator_label?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_message_recovery_events_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "patient_message_attempts"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_message_source_backoff: {
        Row: {
          attempts: number
          claim_token: string
          next_attempt_at: string
          plan_id: string
        }
        Insert: {
          attempts: number
          claim_token: string
          next_attempt_at: string
          plan_id: string
        }
        Update: {
          attempts?: number
          claim_token?: string
          next_attempt_at?: string
          plan_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_message_source_backoff_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: true
            referencedRelation: "patient_care_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_message_spend_policy: {
        Row: {
          allowed_prefixes: string[]
          currency: string | null
          daily_limit_micros: number
          enabled: boolean
          id: number
          max_sms_segments: number
          revision: number
          sms_segment_ceiling_micros: number
          updated_at: string
          valid_until: string | null
          verify_attempt_ceiling_micros: number
          whatsapp_message_ceiling_micros: number
        }
        Insert: {
          allowed_prefixes?: string[]
          currency?: string | null
          daily_limit_micros?: number
          enabled?: boolean
          id?: number
          max_sms_segments?: number
          revision?: number
          sms_segment_ceiling_micros?: number
          updated_at?: string
          valid_until?: string | null
          verify_attempt_ceiling_micros?: number
          whatsapp_message_ceiling_micros?: number
        }
        Update: {
          allowed_prefixes?: string[]
          currency?: string | null
          daily_limit_micros?: number
          enabled?: boolean
          id?: number
          max_sms_segments?: number
          revision?: number
          sms_segment_ceiling_micros?: number
          updated_at?: string
          valid_until?: string | null
          verify_attempt_ceiling_micros?: number
          whatsapp_message_ceiling_micros?: number
        }
        Relationships: []
      }
      patient_message_spend_policy_events: {
        Row: {
          created_at: string
          operator_label: string
          policy: Json
          revision: number
        }
        Insert: {
          created_at?: string
          operator_label: string
          policy: Json
          revision: number
        }
        Update: {
          created_at?: string
          operator_label?: string
          policy?: Json
          revision?: number
        }
        Relationships: []
      }
      patient_message_spend_reservations: {
        Row: {
          amount_micros: number
          attempt_id: string
          budget_day: string
          created_at: string
          currency: string
          policy_revision: number
          segment_allowance: number
        }
        Insert: {
          amount_micros: number
          attempt_id: string
          budget_day: string
          created_at?: string
          currency: string
          policy_revision: number
          segment_allowance: number
        }
        Update: {
          amount_micros?: number
          attempt_id?: string
          budget_day?: string
          created_at?: string
          currency?: string
          policy_revision?: number
          segment_allowance?: number
        }
        Relationships: [
          {
            foreignKeyName: "patient_message_spend_reservations_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: true
            referencedRelation: "patient_message_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_message_spend_reservations_budget_day_currency_fkey"
            columns: ["budget_day", "currency"]
            isOneToOne: false
            referencedRelation: "patient_message_spend_totals"
            referencedColumns: ["budget_day", "currency"]
          },
          {
            foreignKeyName: "patient_message_spend_reservations_policy_revision_fkey"
            columns: ["policy_revision"]
            isOneToOne: false
            referencedRelation: "patient_message_spend_policy_events"
            referencedColumns: ["revision"]
          },
        ]
      }
      patient_message_spend_totals: {
        Row: {
          budget_day: string
          currency: string
          reserved_micros: number
        }
        Insert: {
          budget_day: string
          currency: string
          reserved_micros: number
        }
        Update: {
          budget_day?: string
          currency?: string
          reserved_micros?: number
        }
        Relationships: []
      }
      patient_reminder_preferences: {
        Row: {
          preferences: Json
          revision: number
          updated_at: string
          user_id: string
        }
        Insert: {
          preferences: Json
          revision?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          preferences?: Json
          revision?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      patient_reports: {
        Row: {
          checksum: string | null
          confirmed_at: string | null
          consent_at: string
          consent_version: string
          created_at: string
          deleted_at: string | null
          error_code: string | null
          explanation: Json | null
          extraction: Json | null
          file_name: string
          id: string
          lease_until: string | null
          mime: string
          model: string | null
          object_path: string
          page_count: number | null
          pdf_artifact: Json | null
          prompt_version: string | null
          reviewed: Json | null
          revision: number
          size_bytes: number
          state: string
          storage_purged_at: string | null
          user_id: string
        }
        Insert: {
          checksum?: string | null
          confirmed_at?: string | null
          consent_at?: string
          consent_version: string
          created_at?: string
          deleted_at?: string | null
          error_code?: string | null
          explanation?: Json | null
          extraction?: Json | null
          file_name: string
          id?: string
          lease_until?: string | null
          mime: string
          model?: string | null
          object_path: string
          page_count?: number | null
          pdf_artifact?: Json | null
          prompt_version?: string | null
          reviewed?: Json | null
          revision?: number
          size_bytes: number
          state?: string
          storage_purged_at?: string | null
          user_id: string
        }
        Update: {
          checksum?: string | null
          confirmed_at?: string | null
          consent_at?: string
          consent_version?: string
          created_at?: string
          deleted_at?: string | null
          error_code?: string | null
          explanation?: Json | null
          extraction?: Json | null
          file_name?: string
          id?: string
          lease_until?: string | null
          mime?: string
          model?: string | null
          object_path?: string
          page_count?: number | null
          pdf_artifact?: Json | null
          prompt_version?: string | null
          reviewed?: Json | null
          revision?: number
          size_bytes?: number
          state?: string
          storage_purged_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      patient_test_request_events: {
        Row: {
          actor_id: string
          command_id: string
          created_at: string
          operation: string
          payload: Json
          request_id: string
          result: Json
          revision: number
        }
        Insert: {
          actor_id: string
          command_id: string
          created_at?: string
          operation: string
          payload: Json
          request_id: string
          result: Json
          revision: number
        }
        Update: {
          actor_id?: string
          command_id?: string
          created_at?: string
          operation?: string
          payload?: Json
          request_id?: string
          result?: Json
          revision?: number
        }
        Relationships: [
          {
            foreignKeyName: "patient_test_request_events_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "patient_test_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_test_requests: {
        Row: {
          algorithm_version: string
          context_token: string
          create_payload: Json
          created_at: string
          current_arrangement: Json | null
          id: string
          pending_change: Json | null
          proposal: Json | null
          requested_terms: Json
          requirements: Json
          revision: number
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          algorithm_version: string
          context_token: string
          create_payload: Json
          created_at?: string
          current_arrangement?: Json | null
          id: string
          pending_change?: Json | null
          proposal?: Json | null
          requested_terms: Json
          requirements: Json
          revision?: number
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          algorithm_version?: string
          context_token?: string
          create_payload?: Json
          created_at?: string
          current_arrangement?: Json | null
          id?: string
          pending_change?: Json | null
          proposal?: Json | null
          requested_terms?: Json
          requirements?: Json
          revision?: number
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_test_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "patient_clinical_cases"
            referencedColumns: ["user_id"]
          },
        ]
      }
      pilot_catalog_events: {
        Row: {
          actor_id: string | null
          actor_name: string
          at: string
          detail: Json
          id: string
          kind: string
          reason: string | null
          test_id: string
        }
        Insert: {
          actor_id?: string | null
          actor_name: string
          at?: string
          detail?: Json
          id?: string
          kind: string
          reason?: string | null
          test_id: string
        }
        Update: {
          actor_id?: string | null
          actor_name?: string
          at?: string
          detail?: Json
          id?: string
          kind?: string
          reason?: string | null
          test_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pilot_catalog_events_test_id_fkey"
            columns: ["test_id"]
            isOneToOne: false
            referencedRelation: "pilot_catalog_tests"
            referencedColumns: ["id"]
          },
        ]
      }
      pilot_catalog_prices: {
        Row: {
          effective_from: string
          id: string
          price_amd: number
          price_source: string
          reason: string
          recorded_at: string
          recorded_by: string | null
          recorded_by_name: string
          test_id: string
        }
        Insert: {
          effective_from: string
          id?: string
          price_amd: number
          price_source: string
          reason: string
          recorded_at?: string
          recorded_by?: string | null
          recorded_by_name: string
          test_id: string
        }
        Update: {
          effective_from?: string
          id?: string
          price_amd?: number
          price_source?: string
          reason?: string
          recorded_at?: string
          recorded_by?: string | null
          recorded_by_name?: string
          test_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pilot_catalog_prices_test_id_fkey"
            columns: ["test_id"]
            isOneToOne: false
            referencedRelation: "pilot_catalog_tests"
            referencedColumns: ["id"]
          },
        ]
      }
      pilot_catalog_tests: {
        Row: {
          active_from: string
          active_until: string | null
          created_at: string
          id: string
          included_in_package: boolean
          name_en: string
          name_hy: string
          partner_code: string
          revision: number
          test_key: string
          updated_at: string
        }
        Insert: {
          active_from: string
          active_until?: string | null
          created_at?: string
          id?: string
          included_in_package?: boolean
          name_en: string
          name_hy: string
          partner_code: string
          revision?: number
          test_key: string
          updated_at?: string
        }
        Update: {
          active_from?: string
          active_until?: string | null
          created_at?: string
          id?: string
          included_in_package?: boolean
          name_en?: string
          name_hy?: string
          partner_code?: string
          revision?: number
          test_key?: string
          updated_at?: string
        }
        Relationships: []
      }
      pilot_commands: {
        Row: {
          actor_id: string
          created_at: string
          payload: Json
          result: Json
          submission_id: string
        }
        Insert: {
          actor_id: string
          created_at?: string
          payload: Json
          result: Json
          submission_id: string
        }
        Update: {
          actor_id?: string
          created_at?: string
          payload?: Json
          result?: Json
          submission_id?: string
        }
        Relationships: []
      }
      pilot_payment_events: {
        Row: {
          actor_id: string | null
          actor_kind: string
          actor_name: string
          at: string
          from_status: string | null
          id: string
          kind: string
          payment_id: string
          provider_event_id: string | null
          provider_reference: string | null
          reason: string | null
          to_status: string | null
        }
        Insert: {
          actor_id?: string | null
          actor_kind: string
          actor_name: string
          at?: string
          from_status?: string | null
          id?: string
          kind: string
          payment_id: string
          provider_event_id?: string | null
          provider_reference?: string | null
          reason?: string | null
          to_status?: string | null
        }
        Update: {
          actor_id?: string | null
          actor_kind?: string
          actor_name?: string
          at?: string
          from_status?: string | null
          id?: string
          kind?: string
          payment_id?: string
          provider_event_id?: string | null
          provider_reference?: string | null
          reason?: string | null
          to_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pilot_payment_events_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "pilot_payments"
            referencedColumns: ["id"]
          },
        ]
      }
      pilot_payments: {
        Row: {
          amount_amd: number
          appointment_id: string | null
          created_at: string
          created_by: string
          currency: string
          id: string
          lines: Json
          member_id: string
          price_basis: string
          provider: string
          provider_reference: string | null
          revision: number
          status: string
          test_request_id: string | null
          updated_at: string
        }
        Insert: {
          amount_amd: number
          appointment_id?: string | null
          created_at?: string
          created_by: string
          currency?: string
          id?: string
          lines: Json
          member_id: string
          price_basis: string
          provider?: string
          provider_reference?: string | null
          revision?: number
          status?: string
          test_request_id?: string | null
          updated_at?: string
        }
        Update: {
          amount_amd?: number
          appointment_id?: string | null
          created_at?: string
          created_by?: string
          currency?: string
          id?: string
          lines?: Json
          member_id?: string
          price_basis?: string
          provider?: string
          provider_reference?: string | null
          revision?: number
          status?: string
          test_request_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pilot_payments_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: true
            referencedRelation: "booking_appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pilot_payments_test_request_id_fkey"
            columns: ["test_request_id"]
            isOneToOne: true
            referencedRelation: "patient_test_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          biological_sex: string | null
          birth_date: string | null
          created_at: string
          display_name: string | null
          id: string
          is_test_account: boolean
          locale: string
          test_account_reset_at: string | null
          test_account_reset_count: number
          ui_locale: string | null
          updated_at: string
        }
        Insert: {
          biological_sex?: string | null
          birth_date?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          is_test_account?: boolean
          locale?: string
          test_account_reset_at?: string | null
          test_account_reset_count?: number
          ui_locale?: string | null
          updated_at?: string
        }
        Update: {
          biological_sex?: string | null
          birth_date?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          is_test_account?: boolean
          locale?: string
          test_account_reset_at?: string | null
          test_account_reset_count?: number
          ui_locale?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      programme_checkins: {
        Row: {
          checkpoint_id: string
          feeling: string
          id: string
          medicines: string
          member_id: string
          note: string | null
          submission_id: string
          submitted_at: string
        }
        Insert: {
          checkpoint_id: string
          feeling: string
          id?: string
          medicines: string
          member_id: string
          note?: string | null
          submission_id: string
          submitted_at?: string
        }
        Update: {
          checkpoint_id?: string
          feeling?: string
          id?: string
          medicines?: string
          member_id?: string
          note?: string | null
          submission_id?: string
          submitted_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "programme_checkins_checkpoint_id_fkey"
            columns: ["checkpoint_id"]
            isOneToOne: true
            referencedRelation: "programme_checkpoints"
            referencedColumns: ["id"]
          },
        ]
      }
      programme_checkpoint_events: {
        Row: {
          actor_id: string | null
          checkpoint_id: string
          created_at: string
          detail: Json
          id: number
          kind: string
        }
        Insert: {
          actor_id?: string | null
          checkpoint_id: string
          created_at?: string
          detail?: Json
          id?: never
          kind: string
        }
        Update: {
          actor_id?: string | null
          checkpoint_id?: string
          created_at?: string
          detail?: Json
          id?: never
          kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "programme_checkpoint_events_checkpoint_id_fkey"
            columns: ["checkpoint_id"]
            isOneToOne: false
            referencedRelation: "programme_checkpoints"
            referencedColumns: ["id"]
          },
        ]
      }
      programme_checkpoints: {
        Row: {
          anchor_at: string
          anchor_plan_id: string
          completed_at: string | null
          completed_by: string | null
          completed_by_name: string | null
          created_at: string
          doctor_note: string | null
          due_on: string
          id: string
          kind: string
          member_id: string
          opened_at: string | null
          outcome: string | null
          outcome_plan_id: string | null
          state: string
          submission_id: string | null
        }
        Insert: {
          anchor_at: string
          anchor_plan_id: string
          completed_at?: string | null
          completed_by?: string | null
          completed_by_name?: string | null
          created_at?: string
          doctor_note?: string | null
          due_on: string
          id?: string
          kind: string
          member_id: string
          opened_at?: string | null
          outcome?: string | null
          outcome_plan_id?: string | null
          state?: string
          submission_id?: string | null
        }
        Update: {
          anchor_at?: string
          anchor_plan_id?: string
          completed_at?: string | null
          completed_by?: string | null
          completed_by_name?: string | null
          created_at?: string
          doctor_note?: string | null
          due_on?: string
          id?: string
          kind?: string
          member_id?: string
          opened_at?: string | null
          outcome?: string | null
          outcome_plan_id?: string | null
          state?: string
          submission_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "programme_checkpoints_anchor_plan_id_fkey"
            columns: ["anchor_plan_id"]
            isOneToOne: false
            referencedRelation: "patient_clinical_publications"
            referencedColumns: ["plan_id"]
          },
          {
            foreignKeyName: "programme_checkpoints_outcome_plan_id_fkey"
            columns: ["outcome_plan_id"]
            isOneToOne: false
            referencedRelation: "patient_clinical_publications"
            referencedColumns: ["plan_id"]
          },
        ]
      }
      programme_settings: {
        Row: {
          clinical_note: string
          clinical_status: string
          enabled: boolean
          month3_offset: string
          month6_offset: string
          opens_days_before: number
          singleton: boolean
          updated_at: string
          week4_review_offset: string
        }
        Insert: {
          clinical_note?: string
          clinical_status?: string
          enabled?: boolean
          month3_offset?: string
          month6_offset?: string
          opens_days_before?: number
          singleton?: boolean
          updated_at?: string
          week4_review_offset?: string
        }
        Update: {
          clinical_note?: string
          clinical_status?: string
          enabled?: boolean
          month3_offset?: string
          month6_offset?: string
          opens_days_before?: number
          singleton?: boolean
          updated_at?: string
          week4_review_offset?: string
        }
        Relationships: []
      }
      rate_limit_counters: {
        Row: {
          bucket: string
          expires_at: string
          hits: number
          operation: string
          window_start: string
        }
        Insert: {
          bucket: string
          expires_at: string
          hits: number
          operation: string
          window_start: string
        }
        Update: {
          bucket?: string
          expires_at?: string
          hits?: number
          operation?: string
          window_start?: string
        }
        Relationships: []
      }
      real_staff_admin_events: {
        Row: {
          actor_id: string | null
          clinic_id: string | null
          created_at: string
          details: Json
          generation: number | null
          id: number
          invitation_id: string | null
          kind: string
          request_id: string | null
        }
        Insert: {
          actor_id?: string | null
          clinic_id?: string | null
          created_at?: string
          details?: Json
          generation?: number | null
          id?: never
          invitation_id?: string | null
          kind: string
          request_id?: string | null
        }
        Update: {
          actor_id?: string | null
          clinic_id?: string | null
          created_at?: string
          details?: Json
          generation?: number | null
          id?: never
          invitation_id?: string | null
          kind?: string
          request_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "real_staff_admin_events_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "workspace_clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "real_staff_admin_events_invitation_id_fkey"
            columns: ["invitation_id"]
            isOneToOne: false
            referencedRelation: "real_staff_invitations"
            referencedColumns: ["id"]
          },
        ]
      }
      real_staff_invitations: {
        Row: {
          accepted_at: string | null
          accepted_session_id: string | null
          auth_user_id: string | null
          clinic_id: string
          created_at: string
          delivery: string
          dispatch_claimed_at: string | null
          display_name: string
          email: string
          expected_auth_user_id: string
          expires_at: string
          generation: number
          id: string
          invited_phone: string | null
          issuer_id: string
          last_requested_at: string
          management_revision: number
          operation_id: string
          provider_reference: string | null
          role: string
          send_status: string
          status: string
          token_digest: string | null
          token_type: string | null
          verified_at: string | null
        }
        Insert: {
          accepted_at?: string | null
          accepted_session_id?: string | null
          auth_user_id?: string | null
          clinic_id: string
          created_at?: string
          delivery?: string
          dispatch_claimed_at?: string | null
          display_name: string
          email: string
          expected_auth_user_id?: string
          expires_at?: string
          generation?: number
          id?: string
          invited_phone?: string | null
          issuer_id: string
          last_requested_at?: string
          management_revision?: number
          operation_id?: string
          provider_reference?: string | null
          role?: string
          send_status?: string
          status?: string
          token_digest?: string | null
          token_type?: string | null
          verified_at?: string | null
        }
        Update: {
          accepted_at?: string | null
          accepted_session_id?: string | null
          auth_user_id?: string | null
          clinic_id?: string
          created_at?: string
          delivery?: string
          dispatch_claimed_at?: string | null
          display_name?: string
          email?: string
          expected_auth_user_id?: string
          expires_at?: string
          generation?: number
          id?: string
          invited_phone?: string | null
          issuer_id?: string
          last_requested_at?: string
          management_revision?: number
          operation_id?: string
          provider_reference?: string | null
          role?: string
          send_status?: string
          status?: string
          token_digest?: string | null
          token_type?: string | null
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "real_staff_invitations_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "workspace_clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "real_staff_invitations_issuer_id_fkey"
            columns: ["issuer_id"]
            isOneToOne: false
            referencedRelation: "workspace_staff"
            referencedColumns: ["user_id"]
          },
        ]
      }
      real_staff_management_operations: {
        Row: {
          actor_id: string
          created_at: string
          input: Json
          operation: string
          request_id: string
          result: Json
        }
        Insert: {
          actor_id: string
          created_at?: string
          input: Json
          operation: string
          request_id: string
          result: Json
        }
        Update: {
          actor_id?: string
          created_at?: string
          input?: Json
          operation?: string
          request_id?: string
          result?: Json
        }
        Relationships: []
      }
      real_staff_recoveries: {
        Row: {
          admin_id: string
          completed_at: string | null
          dispatch_claimed_at: string | null
          dispatch_state: string
          expires_at: string
          failure_category: string | null
          generation: number
          id: string
          identity_snapshot: Json
          input: Json
          issued_at: string
          password_attempt: number
          password_claimed_at: string | null
          provider_reference: string | null
          request_id: string
          staff_id: string
          status: string
          token_digest: string | null
          verified_at: string | null
          verified_session_id: string | null
        }
        Insert: {
          admin_id: string
          completed_at?: string | null
          dispatch_claimed_at?: string | null
          dispatch_state?: string
          expires_at?: string
          failure_category?: string | null
          generation: number
          id?: string
          identity_snapshot: Json
          input: Json
          issued_at?: string
          password_attempt?: number
          password_claimed_at?: string | null
          provider_reference?: string | null
          request_id: string
          staff_id: string
          status?: string
          token_digest?: string | null
          verified_at?: string | null
          verified_session_id?: string | null
        }
        Update: {
          admin_id?: string
          completed_at?: string | null
          dispatch_claimed_at?: string | null
          dispatch_state?: string
          expires_at?: string
          failure_category?: string | null
          generation?: number
          id?: string
          identity_snapshot?: Json
          input?: Json
          issued_at?: string
          password_attempt?: number
          password_claimed_at?: string | null
          provider_reference?: string | null
          request_id?: string
          staff_id?: string
          status?: string
          token_digest?: string | null
          verified_at?: string | null
          verified_session_id?: string | null
        }
        Relationships: []
      }
      real_staff_recovery_events: {
        Row: {
          actor_id: string | null
          attempt: number
          created_at: string
          id: number
          kind: string
          recovery_id: string
        }
        Insert: {
          actor_id?: string | null
          attempt?: number
          created_at?: string
          id?: never
          kind: string
          recovery_id: string
        }
        Update: {
          actor_id?: string | null
          attempt?: number
          created_at?: string
          id?: never
          kind?: string
          recovery_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "real_staff_recovery_events_recovery_id_fkey"
            columns: ["recovery_id"]
            isOneToOne: false
            referencedRelation: "real_staff_recoveries"
            referencedColumns: ["id"]
          },
        ]
      }
      report_ai_attempts: {
        Row: {
          created_at: string
          id: number
          operation: string
          report_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: never
          operation: string
          report_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: never
          operation?: string
          report_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_ai_attempts_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "patient_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_care_notes: {
        Row: {
          actor_id: string
          actor_name: string
          actor_role: string
          created_at: string
          detail: Json
          id: string
          kind: string
          note: string
          patient_case_id: string | null
          workspace_case_id: string | null
        }
        Insert: {
          actor_id: string
          actor_name: string
          actor_role: string
          created_at?: string
          detail?: Json
          id?: string
          kind: string
          note: string
          patient_case_id?: string | null
          workspace_case_id?: string | null
        }
        Update: {
          actor_id?: string
          actor_name?: string
          actor_role?: string
          created_at?: string
          detail?: Json
          id?: string
          kind?: string
          note?: string
          patient_case_id?: string | null
          workspace_case_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_care_notes_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "workspace_staff"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "staff_care_notes_patient_case_id_fkey"
            columns: ["patient_case_id"]
            isOneToOne: false
            referencedRelation: "patient_clinical_cases"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "staff_care_notes_workspace_case_id_fkey"
            columns: ["workspace_case_id"]
            isOneToOne: false
            referencedRelation: "workspace_cases"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_code_challenges: {
        Row: {
          attempts: number
          auth_user_id: string
          binding_generation: number
          binding_id: string
          clinic_invitation_id: string | null
          code_hmac: string
          created_at: string
          expires_at: string
          id: string
          invitation_generation: number | null
          invitation_id: string | null
          nonce_hmac: string
          operation_kind: string
          recovery_id: string | null
          session_id: string | null
          state: string
        }
        Insert: {
          attempts?: number
          auth_user_id: string
          binding_generation: number
          binding_id: string
          clinic_invitation_id?: string | null
          code_hmac: string
          created_at?: string
          expires_at: string
          id?: string
          invitation_generation?: number | null
          invitation_id?: string | null
          nonce_hmac: string
          operation_kind?: string
          recovery_id?: string | null
          session_id?: string | null
          state?: string
        }
        Update: {
          attempts?: number
          auth_user_id?: string
          binding_generation?: number
          binding_id?: string
          clinic_invitation_id?: string | null
          code_hmac?: string
          created_at?: string
          expires_at?: string
          id?: string
          invitation_generation?: number | null
          invitation_id?: string | null
          nonce_hmac?: string
          operation_kind?: string
          recovery_id?: string | null
          session_id?: string | null
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_code_challenges_binding_id_fkey"
            columns: ["binding_id"]
            isOneToOne: false
            referencedRelation: "telegram_auth_bindings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_code_challenges_clinic_invitation_id_fkey"
            columns: ["clinic_invitation_id"]
            isOneToOne: false
            referencedRelation: "clinic_portal_invitations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_code_challenges_invitation_id_fkey"
            columns: ["invitation_id"]
            isOneToOne: false
            referencedRelation: "real_staff_invitations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_code_challenges_recovery_id_fkey"
            columns: ["recovery_id"]
            isOneToOne: false
            referencedRelation: "staff_telegram_recoveries"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_message_notice_settings: {
        Row: {
          enabled: boolean
          singleton: boolean
          staff_origin: string
          throttle_seconds: number
          updated_at: string
        }
        Insert: {
          enabled?: boolean
          singleton?: boolean
          staff_origin?: string
          throttle_seconds?: number
          updated_at?: string
        }
        Update: {
          enabled?: boolean
          singleton?: boolean
          staff_origin?: string
          throttle_seconds?: number
          updated_at?: string
        }
        Relationships: []
      }
      staff_message_notices: {
        Row: {
          alert_id: string
          conversation_id: string
          created_at: string
          id: string
          recipient_id: string
          recipient_role: string
          telegram_message_id: string
        }
        Insert: {
          alert_id: string
          conversation_id: string
          created_at?: string
          id?: string
          recipient_id: string
          recipient_role: string
          telegram_message_id: string
        }
        Update: {
          alert_id?: string
          conversation_id?: string
          created_at?: string
          id?: string
          recipient_id?: string
          recipient_role?: string
          telegram_message_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_message_notices_alert_id_fkey"
            columns: ["alert_id"]
            isOneToOne: false
            referencedRelation: "conversation_doctor_alerts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_message_notices_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_message_notices_telegram_message_id_fkey"
            columns: ["telegram_message_id"]
            isOneToOne: true
            referencedRelation: "telegram_auth_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_notice_links: {
        Row: {
          alert_id: string | null
          created_at: string
          expires_at: string
          last_used_at: string | null
          member_id: string
          recipient_id: string
          token_hash: string
        }
        Insert: {
          alert_id?: string | null
          created_at?: string
          expires_at?: string
          last_used_at?: string | null
          member_id: string
          recipient_id: string
          token_hash: string
        }
        Update: {
          alert_id?: string | null
          created_at?: string
          expires_at?: string
          last_used_at?: string | null
          member_id?: string
          recipient_id?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_notice_links_alert_id_fkey"
            columns: ["alert_id"]
            isOneToOne: false
            referencedRelation: "care_alerts"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_telegram_policy: {
        Row: {
          signin_required: boolean
          singleton: boolean
          updated_at: string
        }
        Insert: {
          signin_required?: boolean
          singleton?: boolean
          updated_at?: string
        }
        Update: {
          signin_required?: boolean
          singleton?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      staff_telegram_recoveries: {
        Row: {
          auth_user_id: string
          binding_generation: number
          binding_id: string
          completed_at: string | null
          created_at: string
          expires_at: string
          id: string
          issuer_id: string
          portal: string
          status: string
          token_hash: string | null
          verified_at: string | null
          verified_nonce_hmac: string | null
        }
        Insert: {
          auth_user_id: string
          binding_generation: number
          binding_id: string
          completed_at?: string | null
          created_at?: string
          expires_at: string
          id?: string
          issuer_id: string
          portal: string
          status?: string
          token_hash?: string | null
          verified_at?: string | null
          verified_nonce_hmac?: string | null
        }
        Update: {
          auth_user_id?: string
          binding_generation?: number
          binding_id?: string
          completed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          issuer_id?: string
          portal?: string
          status?: string
          token_hash?: string | null
          verified_at?: string | null
          verified_nonce_hmac?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_telegram_recoveries_binding_id_fkey"
            columns: ["binding_id"]
            isOneToOne: false
            referencedRelation: "telegram_auth_bindings"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_zoe_conversations: {
        Row: {
          created_at: string
          id: string
          last_at: string
          member_id: string
          staff_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_at?: string
          member_id: string
          staff_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_at?: string
          member_id?: string
          staff_id?: string
        }
        Relationships: []
      }
      staff_zoe_messages: {
        Row: {
          body: string
          content: Json
          conversation_id: string
          created_at: string
          role: string
          run_id: string
          seq: number
        }
        Insert: {
          body: string
          content?: Json
          conversation_id: string
          created_at?: string
          role: string
          run_id: string
          seq: number
        }
        Update: {
          body?: string
          content?: Json
          conversation_id?: string
          created_at?: string
          role?: string
          run_id?: string
          seq?: number
        }
        Relationships: [
          {
            foreignKeyName: "staff_zoe_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "staff_zoe_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_zoe_messages_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "staff_zoe_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_zoe_runs: {
        Row: {
          checks: Json
          conversation_id: string
          cost_usd: number | null
          created_at: string
          estimate_usd: number | null
          finished_at: string | null
          id: string
          latency_ms: number | null
          member_id: string
          model: string | null
          prompt_version: string | null
          provider: string | null
          reason: string | null
          reserved: boolean
          sealed_io: string | null
          spend_day: string
          staff_id: string
          staff_role: string
          state: string
          submission_id: string
          tier: string | null
          tools_called: Json
          usage: Json | null
          why: Json | null
        }
        Insert: {
          checks?: Json
          conversation_id: string
          cost_usd?: number | null
          created_at?: string
          estimate_usd?: number | null
          finished_at?: string | null
          id?: string
          latency_ms?: number | null
          member_id: string
          model?: string | null
          prompt_version?: string | null
          provider?: string | null
          reason?: string | null
          reserved?: boolean
          sealed_io?: string | null
          spend_day?: string
          staff_id: string
          staff_role: string
          state?: string
          submission_id: string
          tier?: string | null
          tools_called?: Json
          usage?: Json | null
          why?: Json | null
        }
        Update: {
          checks?: Json
          conversation_id?: string
          cost_usd?: number | null
          created_at?: string
          estimate_usd?: number | null
          finished_at?: string | null
          id?: string
          latency_ms?: number | null
          member_id?: string
          model?: string | null
          prompt_version?: string | null
          provider?: string | null
          reason?: string | null
          reserved?: boolean
          sealed_io?: string | null
          spend_day?: string
          staff_id?: string
          staff_role?: string
          state?: string
          submission_id?: string
          tier?: string | null
          tools_called?: Json
          usage?: Json | null
          why?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_zoe_runs_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "staff_zoe_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_zoe_settings: {
        Row: {
          model_tier: string
          singleton: boolean
          staff_daily_cap_usd: number
          staff_zoe_enabled: boolean
          updated_at: string
        }
        Insert: {
          model_tier?: string
          singleton?: boolean
          staff_daily_cap_usd?: number
          staff_zoe_enabled?: boolean
          updated_at?: string
        }
        Update: {
          model_tier?: string
          singleton?: boolean
          staff_daily_cap_usd?: number
          staff_zoe_enabled?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      system_message_attempts: {
        Row: {
          claimed_at: string
          envelope: Json
          id: string
          message_id: string
          outcome: Json | null
          outcome_at: string | null
          state_seq: number
        }
        Insert: {
          claimed_at?: string
          envelope: Json
          id: string
          message_id: string
          outcome?: Json | null
          outcome_at?: string | null
          state_seq: number
        }
        Update: {
          claimed_at?: string
          envelope?: Json
          id?: string
          message_id?: string
          outcome?: Json | null
          outcome_at?: string | null
          state_seq?: number
        }
        Relationships: [
          {
            foreignKeyName: "system_message_attempts_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: true
            referencedRelation: "system_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      system_message_audit: {
        Row: {
          created_at: string
          detail: Json
          id: number
          kind: string
          message_id: string
        }
        Insert: {
          created_at?: string
          detail: Json
          id?: never
          kind: string
          message_id: string
        }
        Update: {
          created_at?: string
          detail?: Json
          id?: never
          kind?: string
          message_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "system_message_audit_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "system_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      system_message_templates: {
        Row: {
          approval_note: string | null
          approved: boolean
          body: string
          clinical_copy_version: string | null
          created_at: string
          free_body: boolean
          locale: string
          renderer_version: string | null
          substitution_schema: Json | null
          template_id: string
          version: number
        }
        Insert: {
          approval_note?: string | null
          approved?: boolean
          body: string
          clinical_copy_version?: string | null
          created_at?: string
          free_body?: boolean
          locale: string
          renderer_version?: string | null
          substitution_schema?: Json | null
          template_id: string
          version: number
        }
        Update: {
          approval_note?: string | null
          approved?: boolean
          body?: string
          clinical_copy_version?: string | null
          created_at?: string
          free_body?: boolean
          locale?: string
          renderer_version?: string | null
          substitution_schema?: Json | null
          template_id?: string
          version?: number
        }
        Relationships: []
      }
      system_messages: {
        Row: {
          body: string
          body_hash: string
          created_at: string
          endpoint_generation: number
          endpoint_id: string
          id: string
          locale: string
          member_id: string
          reason: string | null
          source_inbox_id: string | null
          state: string
          state_seq: number
          template_id: string
          template_version: number
          updated_at: string
        }
        Insert: {
          body: string
          body_hash: string
          created_at?: string
          endpoint_generation: number
          endpoint_id: string
          id?: string
          locale: string
          member_id: string
          reason?: string | null
          source_inbox_id?: string | null
          state?: string
          state_seq?: number
          template_id: string
          template_version: number
          updated_at?: string
        }
        Update: {
          body?: string
          body_hash?: string
          created_at?: string
          endpoint_generation?: number
          endpoint_id?: string
          id?: string
          locale?: string
          member_id?: string
          reason?: string | null
          source_inbox_id?: string | null
          state?: string
          state_seq?: number
          template_id?: string
          template_version?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "system_messages_endpoint_id_fkey"
            columns: ["endpoint_id"]
            isOneToOne: false
            referencedRelation: "conversation_endpoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "system_messages_source_inbox_id_fkey"
            columns: ["source_inbox_id"]
            isOneToOne: false
            referencedRelation: "channel_inbox"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "system_messages_template_id_template_version_locale_fkey"
            columns: ["template_id", "template_version", "locale"]
            isOneToOne: false
            referencedRelation: "system_message_templates"
            referencedColumns: ["template_id", "version", "locale"]
          },
        ]
      }
      telegram_audit: {
        Row: {
          created_at: string
          detail: Json
          id: number
          kind: string
          member_id: string | null
        }
        Insert: {
          created_at?: string
          detail: Json
          id?: never
          kind: string
          member_id?: string | null
        }
        Update: {
          created_at?: string
          detail?: Json
          id?: never
          kind?: string
          member_id?: string | null
        }
        Relationships: []
      }
      telegram_auth_audit: {
        Row: {
          auth_user_id: string | null
          created_at: string
          detail: Json
          id: number
          kind: string
        }
        Insert: {
          auth_user_id?: string | null
          created_at?: string
          detail: Json
          id?: never
          kind: string
        }
        Update: {
          auth_user_id?: string | null
          created_at?: string
          detail?: Json
          id?: never
          kind?: string
        }
        Relationships: []
      }
      telegram_auth_bindings: {
        Row: {
          account_ref: string
          active: boolean
          address: string
          auth_user_id: string
          created_at: string
          generation: number
          id: string
          kind: string
          pending_clinic_invitation_id: string | null
          pending_invitation_id: string | null
          phone: string
          principal_ref: string
          proven_at: string
          proven_by: string | null
          revoked_at: string | null
          revoked_reason: string | null
        }
        Insert: {
          account_ref: string
          active?: boolean
          address: string
          auth_user_id: string
          created_at?: string
          generation: number
          id?: string
          kind: string
          pending_clinic_invitation_id?: string | null
          pending_invitation_id?: string | null
          phone: string
          principal_ref: string
          proven_at?: string
          proven_by?: string | null
          revoked_at?: string | null
          revoked_reason?: string | null
        }
        Update: {
          account_ref?: string
          active?: boolean
          address?: string
          auth_user_id?: string
          created_at?: string
          generation?: number
          id?: string
          kind?: string
          pending_clinic_invitation_id?: string | null
          pending_invitation_id?: string | null
          phone?: string
          principal_ref?: string
          proven_at?: string
          proven_by?: string | null
          revoked_at?: string | null
          revoked_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "telegram_auth_bindings_pending_clinic_invitation_id_fkey"
            columns: ["pending_clinic_invitation_id"]
            isOneToOne: false
            referencedRelation: "clinic_portal_invitations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telegram_auth_bindings_pending_invitation_id_fkey"
            columns: ["pending_invitation_id"]
            isOneToOne: false
            referencedRelation: "real_staff_invitations"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_auth_challenges: {
        Row: {
          allow_replace: boolean
          clinic_invitation_id: string | null
          consent_version: string | null
          created_at: string
          expires_at: string
          id: string
          invitation_generation: number | null
          invitation_id: string | null
          issued_by: string | null
          nonce_hmac: string | null
          purpose: string
          state: string
          target_phone: string
          target_user: string | null
          token_hash: string
        }
        Insert: {
          allow_replace?: boolean
          clinic_invitation_id?: string | null
          consent_version?: string | null
          created_at?: string
          expires_at: string
          id?: string
          invitation_generation?: number | null
          invitation_id?: string | null
          issued_by?: string | null
          nonce_hmac?: string | null
          purpose: string
          state?: string
          target_phone: string
          target_user?: string | null
          token_hash: string
        }
        Update: {
          allow_replace?: boolean
          clinic_invitation_id?: string | null
          consent_version?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          invitation_generation?: number | null
          invitation_id?: string | null
          issued_by?: string | null
          nonce_hmac?: string | null
          purpose?: string
          state?: string
          target_phone?: string
          target_user?: string | null
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "telegram_auth_challenges_clinic_invitation_id_fkey"
            columns: ["clinic_invitation_id"]
            isOneToOne: false
            referencedRelation: "clinic_portal_invitations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telegram_auth_challenges_invitation_id_fkey"
            columns: ["invitation_id"]
            isOneToOne: false
            referencedRelation: "real_staff_invitations"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_auth_message_attempts: {
        Row: {
          claimed_at: string
          envelope: Json
          id: string
          message_id: string
          outcome: Json | null
          outcome_at: string | null
          state_seq: number
        }
        Insert: {
          claimed_at?: string
          envelope: Json
          id: string
          message_id: string
          outcome?: Json | null
          outcome_at?: string | null
          state_seq: number
        }
        Update: {
          claimed_at?: string
          envelope?: Json
          id?: string
          message_id?: string
          outcome?: Json | null
          outcome_at?: string | null
          state_seq?: number
        }
        Relationships: [
          {
            foreignKeyName: "telegram_auth_message_attempts_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: true
            referencedRelation: "telegram_auth_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_auth_messages: {
        Row: {
          address: string
          body: string
          created_at: string
          defer_until: string | null
          id: string
          keyboard: Json | null
          locale: string
          params: Json | null
          principal_ref: string
          reason: string | null
          source_inbox_id: string | null
          state: string
          state_seq: number
          template_id: string
          template_version: number
          updated_at: string
        }
        Insert: {
          address: string
          body: string
          created_at?: string
          defer_until?: string | null
          id?: string
          keyboard?: Json | null
          locale: string
          params?: Json | null
          principal_ref: string
          reason?: string | null
          source_inbox_id?: string | null
          state?: string
          state_seq?: number
          template_id: string
          template_version: number
          updated_at?: string
        }
        Update: {
          address?: string
          body?: string
          created_at?: string
          defer_until?: string | null
          id?: string
          keyboard?: Json | null
          locale?: string
          params?: Json | null
          principal_ref?: string
          reason?: string | null
          source_inbox_id?: string | null
          state?: string
          state_seq?: number
          template_id?: string
          template_version?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "telegram_auth_messages_source_inbox_id_fkey"
            columns: ["source_inbox_id"]
            isOneToOne: false
            referencedRelation: "channel_inbox"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telegram_auth_messages_template_id_template_version_locale_fkey"
            columns: ["template_id", "template_version", "locale"]
            isOneToOne: false
            referencedRelation: "system_message_templates"
            referencedColumns: ["template_id", "version", "locale"]
          },
        ]
      }
      telegram_channel_settings: {
        Row: {
          account: string
          bot_id: number
          consent_version: string
          link_token_seconds: number
          singleton: boolean
        }
        Insert: {
          account: string
          bot_id: number
          consent_version: string
          link_token_seconds: number
          singleton?: boolean
        }
        Update: {
          account?: string
          bot_id?: number
          consent_version?: string
          link_token_seconds?: number
          singleton?: boolean
        }
        Relationships: []
      }
      telegram_contact_requests: {
        Row: {
          address: string
          challenge_id: string
          expires_at: string
          id: string
          principal_ref: string
          refusal: string | null
          requested_at: string
          state: string
        }
        Insert: {
          address: string
          challenge_id: string
          expires_at: string
          id?: string
          principal_ref: string
          refusal?: string | null
          requested_at?: string
          state?: string
        }
        Update: {
          address?: string
          challenge_id?: string
          expires_at?: string
          id?: string
          principal_ref?: string
          refusal?: string | null
          requested_at?: string
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "telegram_contact_requests_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "telegram_auth_challenges"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_link_tokens: {
        Row: {
          consent_version: string
          consumed_at: string | null
          consumed_principal: string | null
          consumed_result: string | null
          created_at: string
          expires_at: string
          id: string
          member_id: string
          purpose: string
          revoked_at: string | null
          token_hash: string
        }
        Insert: {
          consent_version: string
          consumed_at?: string | null
          consumed_principal?: string | null
          consumed_result?: string | null
          created_at?: string
          expires_at: string
          id?: string
          member_id: string
          purpose: string
          revoked_at?: string | null
          token_hash: string
        }
        Update: {
          consent_version?: string
          consumed_at?: string | null
          consumed_principal?: string | null
          consumed_result?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          member_id?: string
          purpose?: string
          revoked_at?: string | null
          token_hash?: string
        }
        Relationships: []
      }
      telegram_nurse_dialogs: {
        Row: {
          binding_id: string
          expected_mode: string
          expires_at: string
          generation: number
          pending_inbox: string | null
          prompt_message_id: string | null
          question_key: string
          question_version: number
          task_id: string | null
          task_revision: number | null
          visit_completion_ids: Json | null
          visit_flow: Json
          visit_id: string | null
          visit_member_id: string | null
          visit_question_key: string | null
          visit_snapshot_token: string | null
          visit_source: string | null
        }
        Insert: {
          binding_id: string
          expected_mode?: string
          expires_at?: string
          generation: number
          pending_inbox?: string | null
          prompt_message_id?: string | null
          question_key?: string
          question_version?: number
          task_id?: string | null
          task_revision?: number | null
          visit_completion_ids?: Json | null
          visit_flow?: Json
          visit_id?: string | null
          visit_member_id?: string | null
          visit_question_key?: string | null
          visit_snapshot_token?: string | null
          visit_source?: string | null
        }
        Update: {
          binding_id?: string
          expected_mode?: string
          expires_at?: string
          generation?: number
          pending_inbox?: string | null
          prompt_message_id?: string | null
          question_key?: string
          question_version?: number
          task_id?: string | null
          task_revision?: number | null
          visit_completion_ids?: Json | null
          visit_flow?: Json
          visit_id?: string | null
          visit_member_id?: string | null
          visit_question_key?: string | null
          visit_snapshot_token?: string | null
          visit_source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "telegram_nurse_dialogs_binding_id_fkey"
            columns: ["binding_id"]
            isOneToOne: false
            referencedRelation: "telegram_auth_bindings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telegram_nurse_dialogs_pending_inbox_fkey"
            columns: ["pending_inbox"]
            isOneToOne: false
            referencedRelation: "channel_inbox"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telegram_nurse_dialogs_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "patient_coordination_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_nurse_intents: {
        Row: {
          binding_id: string
          carrier_message_id: string | null
          expires_at: string
          generation: number
          outbox_id: string
          question_version: number
          ref_hash: string
          task_id: string | null
          task_revision: number | null
          used_at: string | null
          visit_action: string | null
          visit_id: string | null
          visit_member_id: string | null
          visit_question_key: string | null
          visit_snapshot_token: string | null
          visit_source: string | null
        }
        Insert: {
          binding_id: string
          carrier_message_id?: string | null
          expires_at: string
          generation: number
          outbox_id: string
          question_version: number
          ref_hash: string
          task_id?: string | null
          task_revision?: number | null
          used_at?: string | null
          visit_action?: string | null
          visit_id?: string | null
          visit_member_id?: string | null
          visit_question_key?: string | null
          visit_snapshot_token?: string | null
          visit_source?: string | null
        }
        Update: {
          binding_id?: string
          carrier_message_id?: string | null
          expires_at?: string
          generation?: number
          outbox_id?: string
          question_version?: number
          ref_hash?: string
          task_id?: string | null
          task_revision?: number | null
          used_at?: string | null
          visit_action?: string | null
          visit_id?: string | null
          visit_member_id?: string | null
          visit_question_key?: string | null
          visit_snapshot_token?: string | null
          visit_source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "telegram_nurse_intents_binding_id_generation_fkey"
            columns: ["binding_id", "generation"]
            isOneToOne: false
            referencedRelation: "telegram_nurse_dialogs"
            referencedColumns: ["binding_id", "generation"]
          },
          {
            foreignKeyName: "telegram_nurse_intents_outbox_id_fkey"
            columns: ["outbox_id"]
            isOneToOne: false
            referencedRelation: "telegram_nurse_outbox"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telegram_nurse_intents_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "patient_coordination_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_nurse_outbox: {
        Row: {
          abandoned: boolean
          attempt_id: string | null
          binding_id: string
          claimed_at: string | null
          created_at: string
          generation: number
          id: string
          locale: string
          member_ids: string[]
          ordinal: number
          outcome: Json | null
          provider_ref: string | null
          question_version: number
          sequence: number
          source_inbox: string
          state: string
          template_id: string
          template_version: number
          turn: Json
        }
        Insert: {
          abandoned?: boolean
          attempt_id?: string | null
          binding_id: string
          claimed_at?: string | null
          created_at?: string
          generation: number
          id?: string
          locale: string
          member_ids?: string[]
          ordinal: number
          outcome?: Json | null
          provider_ref?: string | null
          question_version: number
          sequence?: never
          source_inbox: string
          state?: string
          template_id: string
          template_version?: number
          turn: Json
        }
        Update: {
          abandoned?: boolean
          attempt_id?: string | null
          binding_id?: string
          claimed_at?: string | null
          created_at?: string
          generation?: number
          id?: string
          locale?: string
          member_ids?: string[]
          ordinal?: number
          outcome?: Json | null
          provider_ref?: string | null
          question_version?: number
          sequence?: never
          source_inbox?: string
          state?: string
          template_id?: string
          template_version?: number
          turn?: Json
        }
        Relationships: [
          {
            foreignKeyName: "telegram_nurse_outbox_binding_id_generation_fkey"
            columns: ["binding_id", "generation"]
            isOneToOne: false
            referencedRelation: "telegram_nurse_dialogs"
            referencedColumns: ["binding_id", "generation"]
          },
          {
            foreignKeyName: "telegram_nurse_outbox_source_inbox_fkey"
            columns: ["source_inbox"]
            isOneToOne: false
            referencedRelation: "channel_inbox"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telegram_nurse_outbox_template_id_template_version_locale_fkey"
            columns: ["template_id", "template_version", "locale"]
            isOneToOne: false
            referencedRelation: "system_message_templates"
            referencedColumns: ["template_id", "version", "locale"]
          },
        ]
      }
      telegram_nurse_settings: {
        Row: {
          enabled: boolean
          singleton: boolean
        }
        Insert: {
          enabled?: boolean
          singleton?: boolean
        }
        Update: {
          enabled?: boolean
          singleton?: boolean
        }
        Relationships: []
      }
      telegram_phone_proofs: {
        Row: {
          account_ref: string
          address: string
          cancelled_at: string | null
          challenge_id: string
          consumed_at: string | null
          expires_at: string
          id: string
          nonce_hmac: string | null
          phone: string
          principal_ref: string
          proven_at: string
        }
        Insert: {
          account_ref: string
          address: string
          cancelled_at?: string | null
          challenge_id: string
          consumed_at?: string | null
          expires_at: string
          id?: string
          nonce_hmac?: string | null
          phone: string
          principal_ref: string
          proven_at?: string
        }
        Update: {
          account_ref?: string
          address?: string
          cancelled_at?: string | null
          challenge_id?: string
          consumed_at?: string | null
          expires_at?: string
          id?: string
          nonce_hmac?: string | null
          phone?: string
          principal_ref?: string
          proven_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "telegram_phone_proofs_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: true
            referencedRelation: "telegram_auth_challenges"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_signin_links: {
        Row: {
          armed_at: string | null
          auth_user_id: string
          binding_generation: number
          binding_id: string
          created_at: string
          delivery_id: string | null
          expires_at: string | null
          id: string
          message_id: string | null
          principal_ref: string
          redeem_nonce_hmac: string | null
          request_id: string | null
          state: string
          step: string
          system_message_id: string | null
          token_hash: string | null
          used_at: string | null
        }
        Insert: {
          armed_at?: string | null
          auth_user_id: string
          binding_generation: number
          binding_id: string
          created_at?: string
          delivery_id?: string | null
          expires_at?: string | null
          id?: string
          message_id?: string | null
          principal_ref: string
          redeem_nonce_hmac?: string | null
          request_id?: string | null
          state?: string
          step: string
          system_message_id?: string | null
          token_hash?: string | null
          used_at?: string | null
        }
        Update: {
          armed_at?: string | null
          auth_user_id?: string
          binding_generation?: number
          binding_id?: string
          created_at?: string
          delivery_id?: string | null
          expires_at?: string | null
          id?: string
          message_id?: string | null
          principal_ref?: string
          redeem_nonce_hmac?: string | null
          request_id?: string | null
          state?: string
          step?: string
          system_message_id?: string | null
          token_hash?: string | null
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "telegram_signin_links_binding_id_fkey"
            columns: ["binding_id"]
            isOneToOne: false
            referencedRelation: "telegram_auth_bindings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telegram_signin_links_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: true
            referencedRelation: "conversation_deliveries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telegram_signin_links_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: true
            referencedRelation: "telegram_auth_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telegram_signin_links_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "auth_code_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telegram_signin_links_system_message_id_fkey"
            columns: ["system_message_id"]
            isOneToOne: true
            referencedRelation: "system_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      test_account_audit: {
        Row: {
          action: string
          actor_id: string
          actor_role: string
          at: string
          details: Json
          id: number
          member_id: string
          reset_id: string | null
          session_id: string | null
        }
        Insert: {
          action: string
          actor_id: string
          actor_role: string
          at?: string
          details?: Json
          id?: never
          member_id: string
          reset_id?: string | null
          session_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string
          actor_role?: string
          at?: string
          details?: Json
          id?: never
          member_id?: string
          reset_id?: string | null
          session_id?: string | null
        }
        Relationships: []
      }
      test_account_resets: {
        Row: {
          actor_id: string
          actor_role: string
          claim_token: string | null
          claimed_at: string | null
          finished_at: string | null
          id: string
          member_id: string
          placeholder_phone: string
          previous_phone: string | null
          request_key: string
          sessions_revoked: number
          started_at: string
          state: string
          telegram_revoked: boolean
        }
        Insert: {
          actor_id: string
          actor_role: string
          claim_token?: string | null
          claimed_at?: string | null
          finished_at?: string | null
          id?: string
          member_id: string
          placeholder_phone: string
          previous_phone?: string | null
          request_key: string
          sessions_revoked: number
          started_at?: string
          state?: string
          telegram_revoked: boolean
        }
        Update: {
          actor_id?: string
          actor_role?: string
          claim_token?: string | null
          claimed_at?: string | null
          finished_at?: string | null
          id?: string
          member_id?: string
          placeholder_phone?: string
          previous_phone?: string | null
          request_key?: string
          sessions_revoked?: number
          started_at?: string
          state?: string
          telegram_revoked?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "test_account_resets_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      test_signin_challenges: {
        Row: {
          checked_at: string | null
          expires_at: string
          number_id: string
          request_id: string
        }
        Insert: {
          checked_at?: string | null
          expires_at?: string
          number_id: string
          request_id: string
        }
        Update: {
          checked_at?: string | null
          expires_at?: string
          number_id?: string
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "test_signin_challenges_number_id_fkey"
            columns: ["number_id"]
            isOneToOne: false
            referencedRelation: "test_signin_numbers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_signin_challenges_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: true
            referencedRelation: "auth_code_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      test_signin_numbers: {
        Row: {
          active: boolean
          code_hash: string
          code_used_at: string | null
          created_at: string
          created_by: string
          expires_at: string
          failed_attempts: number
          id: string
          label: string
          phone: string
          window_started_at: string | null
        }
        Insert: {
          active?: boolean
          code_hash: string
          code_used_at?: string | null
          created_at?: string
          created_by: string
          expires_at: string
          failed_attempts?: number
          id?: string
          label: string
          phone: string
          window_started_at?: string | null
        }
        Update: {
          active?: boolean
          code_hash?: string
          code_used_at?: string | null
          created_at?: string
          created_by?: string
          expires_at?: string
          failed_attempts?: number
          id?: string
          label?: string
          phone?: string
          window_started_at?: string | null
        }
        Relationships: []
      }
      test_signin_settings: {
        Row: {
          enabled: boolean
          singleton: boolean
        }
        Insert: {
          enabled?: boolean
          singleton?: boolean
        }
        Update: {
          enabled?: boolean
          singleton?: boolean
        }
        Relationships: []
      }
      urgent_answer_changes: {
        Row: {
          alert_id: string | null
          alerts_on: boolean
          assessment_id: string
          changed_fields: Json
          created_at: string
          current_rule: string | null
          id: number
          member_id: string
          previous_rule: string
          revision: number
        }
        Insert: {
          alert_id?: string | null
          alerts_on?: boolean
          assessment_id: string
          changed_fields?: Json
          created_at?: string
          current_rule?: string | null
          id?: never
          member_id: string
          previous_rule: string
          revision: number
        }
        Update: {
          alert_id?: string | null
          alerts_on?: boolean
          assessment_id?: string
          changed_fields?: Json
          created_at?: string
          current_rule?: string | null
          id?: never
          member_id?: string
          previous_rule?: string
          revision?: number
        }
        Relationships: [
          {
            foreignKeyName: "urgent_answer_changes_alert_id_fkey"
            columns: ["alert_id"]
            isOneToOne: false
            referencedRelation: "care_alerts"
            referencedColumns: ["id"]
          },
        ]
      }
      voice_settings: {
        Row: {
          enabled: boolean
          id: boolean
          stt_model: string
          stt_urgent_model: string
          tts_instructions: string
          tts_model: string
          tts_voice: string
          updated_at: string
          version: number
        }
        Insert: {
          enabled?: boolean
          id?: boolean
          stt_model?: string
          stt_urgent_model?: string
          tts_instructions?: string
          tts_model?: string
          tts_voice?: string
          updated_at?: string
          version?: number
        }
        Update: {
          enabled?: boolean
          id?: boolean
          stt_model?: string
          stt_urgent_model?: string
          tts_instructions?: string
          tts_model?: string
          tts_voice?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      workspace_accepted_readings: {
        Row: {
          accepted_at: string
          case_id: string
          diastolic: number
          id: string
          measured_at: string
          pulse: number | null
          submission_id: string
          systolic: number
        }
        Insert: {
          accepted_at?: string
          case_id: string
          diastolic: number
          id?: string
          measured_at: string
          pulse?: number | null
          submission_id: string
          systolic: number
        }
        Update: {
          accepted_at?: string
          case_id?: string
          diastolic?: number
          id?: string
          measured_at?: string
          pulse?: number | null
          submission_id?: string
          systolic?: number
        }
        Relationships: [
          {
            foreignKeyName: "workspace_accepted_readings_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "workspace_cases"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_activity: {
        Row: {
          actor_id: string
          actor_label: string
          case_id: string
          case_revision: number
          created_at: string
          id: number
          kind: string
        }
        Insert: {
          actor_id: string
          actor_label: string
          case_id: string
          case_revision: number
          created_at?: string
          id?: never
          kind: string
        }
        Update: {
          actor_id?: string
          actor_label?: string
          case_id?: string
          case_revision?: number
          created_at?: string
          id?: never
          kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_activity_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "workspace_cases"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_admission_counters: {
        Row: {
          attempts: number
          bucket: string
          expires_at: string
          operation: string
          window_start: string
        }
        Insert: {
          attempts: number
          bucket: string
          expires_at: string
          operation: string
          window_start: string
        }
        Update: {
          attempts?: number
          bucket?: string
          expires_at?: string
          operation?: string
          window_start?: string
        }
        Relationships: []
      }
      workspace_case_reports: {
        Row: {
          approval: Json | null
          case_id: string
          created_at: string
          id: string
          published: Json | null
          record: Json
          revision: number
          updated_at: string
        }
        Insert: {
          approval?: Json | null
          case_id: string
          created_at?: string
          id: string
          published?: Json | null
          record: Json
          revision?: number
          updated_at?: string
        }
        Update: {
          approval?: Json | null
          case_id?: string
          created_at?: string
          id?: string
          published?: Json | null
          record?: Json
          revision?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_case_reports_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "workspace_cases"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_cases: {
        Row: {
          assigned_doctor_id: string | null
          assigned_nurse_id: string | null
          created_at: string
          draft_evidence_revision: number | null
          draft_saved_at: string | null
          draft_saved_by: string | null
          evidence_revision: number
          expires_at: string
          id: string
          reviewed_evidence_revision: number | null
          revision: number
          state: Json
        }
        Insert: {
          assigned_doctor_id?: string | null
          assigned_nurse_id?: string | null
          created_at?: string
          draft_evidence_revision?: number | null
          draft_saved_at?: string | null
          draft_saved_by?: string | null
          evidence_revision?: number
          expires_at?: string
          id?: string
          reviewed_evidence_revision?: number | null
          revision?: number
          state?: Json
        }
        Update: {
          assigned_doctor_id?: string | null
          assigned_nurse_id?: string | null
          created_at?: string
          draft_evidence_revision?: number | null
          draft_saved_at?: string | null
          draft_saved_by?: string | null
          evidence_revision?: number
          expires_at?: string
          id?: string
          reviewed_evidence_revision?: number | null
          revision?: number
          state?: Json
        }
        Relationships: [
          {
            foreignKeyName: "workspace_cases_assigned_doctor_id_fkey"
            columns: ["assigned_doctor_id"]
            isOneToOne: false
            referencedRelation: "workspace_staff"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "workspace_cases_assigned_nurse_id_fkey"
            columns: ["assigned_nurse_id"]
            isOneToOne: false
            referencedRelation: "workspace_staff"
            referencedColumns: ["user_id"]
          },
        ]
      }
      workspace_clinics: {
        Row: {
          active: boolean
          address: string
          created_at: string
          id: string
          name: string
          scheduling_email: string | null
          scheduling_revision: number
        }
        Insert: {
          active?: boolean
          address?: string
          created_at?: string
          id?: string
          name: string
          scheduling_email?: string | null
          scheduling_revision?: number
        }
        Update: {
          active?: boolean
          address?: string
          created_at?: string
          id?: string
          name?: string
          scheduling_email?: string | null
          scheduling_revision?: number
        }
        Relationships: []
      }
      workspace_dose_event_history: {
        Row: {
          case_id: string
          due_at: string
          kind: string
          medication_id: string
          plan_id: string | null
          recorded_at: string
          revision: number
          status: string
        }
        Insert: {
          case_id: string
          due_at: string
          kind: string
          medication_id: string
          plan_id?: string | null
          recorded_at: string
          revision: number
          status: string
        }
        Update: {
          case_id?: string
          due_at?: string
          kind?: string
          medication_id?: string
          plan_id?: string | null
          recorded_at?: string
          revision?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_dose_event_history_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "workspace_cases"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_evidence_changes: {
        Row: {
          case_id: string
          created_at: string
          id: number
          kind: string
          reference_id: string | null
          revision: number
        }
        Insert: {
          case_id: string
          created_at?: string
          id?: never
          kind: string
          reference_id?: string | null
          revision: number
        }
        Update: {
          case_id?: string
          created_at?: string
          id?: never
          kind?: string
          reference_id?: string | null
          revision?: number
        }
        Relationships: [
          {
            foreignKeyName: "workspace_evidence_changes_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "workspace_cases"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_followup_events: {
        Row: {
          actor_id: string | null
          actor_label: string
          created_at: string
          id: number
          kind: string
          note: string | null
          requirement_id: string
        }
        Insert: {
          actor_id?: string | null
          actor_label: string
          created_at?: string
          id?: never
          kind: string
          note?: string | null
          requirement_id: string
        }
        Update: {
          actor_id?: string | null
          actor_label?: string
          created_at?: string
          id?: never
          kind?: string
          note?: string | null
          requirement_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_followup_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "workspace_staff"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "workspace_followup_events_requirement_id_fkey"
            columns: ["requirement_id"]
            isOneToOne: false
            referencedRelation: "workspace_monitoring_requirements"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_followup_review_links: {
        Row: {
          case_id: string
          created_at: string
          event: string
          requirement_id: string
          review_task_id: string
        }
        Insert: {
          case_id: string
          created_at?: string
          event: string
          requirement_id: string
          review_task_id: string
        }
        Update: {
          case_id?: string
          created_at?: string
          event?: string
          requirement_id?: string
          review_task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_followup_review_links_case_id_requirement_id_fkey"
            columns: ["case_id", "requirement_id"]
            isOneToOne: false
            referencedRelation: "workspace_monitoring_requirements"
            referencedColumns: ["case_id", "id"]
          },
          {
            foreignKeyName: "workspace_followup_review_links_case_id_review_task_id_fkey"
            columns: ["case_id", "review_task_id"]
            isOneToOne: false
            referencedRelation: "workspace_review_tasks"
            referencedColumns: ["case_id", "id"]
          },
        ]
      }
      workspace_followup_work: {
        Row: {
          case_id: string
          due_at: string
          requirement_id: string
          resolved_at: string | null
          status: string
        }
        Insert: {
          case_id: string
          due_at: string
          requirement_id: string
          resolved_at?: string | null
          status?: string
        }
        Update: {
          case_id?: string
          due_at?: string
          requirement_id?: string
          resolved_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_followup_work_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "workspace_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_followup_work_case_id_requirement_id_fkey"
            columns: ["case_id", "requirement_id"]
            isOneToOne: false
            referencedRelation: "workspace_monitoring_requirements"
            referencedColumns: ["case_id", "id"]
          },
        ]
      }
      workspace_monitoring_decisions: {
        Row: {
          actor_id: string | null
          created_at: string
          decision: string
          draft: Json
          evidence_revision: number
          publication_version: number
          requirement_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          decision: string
          draft: Json
          evidence_revision: number
          publication_version: number
          requirement_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          decision?: string
          draft?: Json
          evidence_revision?: number
          publication_version?: number
          requirement_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_monitoring_decisions_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "workspace_staff"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "workspace_monitoring_decisions_requirement_id_fkey"
            columns: ["requirement_id"]
            isOneToOne: true
            referencedRelation: "workspace_monitoring_requirements"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_monitoring_evidence: {
        Row: {
          case_id: string
          late: boolean
          reading_id: string
          requirement_id: string
        }
        Insert: {
          case_id: string
          late: boolean
          reading_id: string
          requirement_id: string
        }
        Update: {
          case_id?: string
          late?: boolean
          reading_id?: string
          requirement_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_monitoring_evidence_case_id_reading_id_fkey"
            columns: ["case_id", "reading_id"]
            isOneToOne: false
            referencedRelation: "workspace_accepted_readings"
            referencedColumns: ["case_id", "id"]
          },
          {
            foreignKeyName: "workspace_monitoring_evidence_case_id_requirement_id_fkey"
            columns: ["case_id", "requirement_id"]
            isOneToOne: false
            referencedRelation: "workspace_monitoring_requirements"
            referencedColumns: ["case_id", "id"]
          },
        ]
      }
      workspace_monitoring_requirements: {
        Row: {
          acknowledged_at: string | null
          actor_id: string | null
          actor_label: string
          case_id: string
          created_at: string
          current_publication: number
          ends_at: string
          id: string
          instructions: string
          required_count: number
          revision: number
          source_publication: number
          source_snapshot: Json
          starts_at: string
          status: string
        }
        Insert: {
          acknowledged_at?: string | null
          actor_id?: string | null
          actor_label: string
          case_id: string
          created_at?: string
          current_publication: number
          ends_at: string
          id?: string
          instructions: string
          required_count: number
          revision?: number
          source_publication: number
          source_snapshot: Json
          starts_at: string
          status?: string
        }
        Update: {
          acknowledged_at?: string | null
          actor_id?: string | null
          actor_label?: string
          case_id?: string
          created_at?: string
          current_publication?: number
          ends_at?: string
          id?: string
          instructions?: string
          required_count?: number
          revision?: number
          source_publication?: number
          source_snapshot?: Json
          starts_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_monitoring_requirements_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "workspace_staff"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "workspace_monitoring_requirements_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "workspace_cases"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_notifications: {
        Row: {
          event_id: number
          id: number
          read_at: string | null
          recipient: string
        }
        Insert: {
          event_id: number
          id?: never
          read_at?: string | null
          recipient: string
        }
        Update: {
          event_id?: number
          id?: never
          read_at?: string | null
          recipient?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_notifications_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "workspace_activity"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_report_cleanup: {
        Row: {
          created_at: string
          object_path: string
        }
        Insert: {
          created_at?: string
          object_path: string
        }
        Update: {
          created_at?: string
          object_path?: string
        }
        Relationships: []
      }
      workspace_review_tasks: {
        Row: {
          case_id: string
          completed_at: string | null
          completed_by: string | null
          completed_by_label: string | null
          completed_evidence_revision: number | null
          completion_note: string | null
          id: string
          opened_at: string
          opened_evidence_revision: number
          outcome: string | null
          owner_id: string | null
          reason: string
          status: string
          target_evidence_revision: number
          updated_at: string
        }
        Insert: {
          case_id: string
          completed_at?: string | null
          completed_by?: string | null
          completed_by_label?: string | null
          completed_evidence_revision?: number | null
          completion_note?: string | null
          id?: string
          opened_at?: string
          opened_evidence_revision: number
          outcome?: string | null
          owner_id?: string | null
          reason: string
          status?: string
          target_evidence_revision: number
          updated_at?: string
        }
        Update: {
          case_id?: string
          completed_at?: string | null
          completed_by?: string | null
          completed_by_label?: string | null
          completed_evidence_revision?: number | null
          completion_note?: string | null
          id?: string
          opened_at?: string
          opened_evidence_revision?: number
          outcome?: string | null
          owner_id?: string | null
          reason?: string
          status?: string
          target_evidence_revision?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_review_tasks_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "workspace_cases"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_scheduling_settings: {
        Row: {
          copy_email: string | null
          id: boolean
          revision: number
        }
        Insert: {
          copy_email?: string | null
          id?: boolean
          revision?: number
        }
        Update: {
          copy_email?: string | null
          id?: boolean
          revision?: number
        }
        Relationships: []
      }
      workspace_staff: {
        Row: {
          active: boolean
          clinic_id: string | null
          created_at: string
          display_name: string
          management_revision: number
          removed_at: string | null
          role: string
          sees_test_members: boolean
          user_id: string
        }
        Insert: {
          active?: boolean
          clinic_id?: string | null
          created_at?: string
          display_name: string
          management_revision?: number
          removed_at?: string | null
          role: string
          sees_test_members?: boolean
          user_id: string
        }
        Update: {
          active?: boolean
          clinic_id?: string | null
          created_at?: string
          display_name?: string
          management_revision?: number
          removed_at?: string | null
          role?: string
          sees_test_members?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_staff_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "workspace_clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      zoe_bp_staff_items: {
        Row: {
          alert_id: string | null
          alert_readings: Json
          checked_at: string
          ends_at: string
          episode_minutes: number
          episode_refs: string[]
          id: string
          measurement_ids: string[]
          member_id: string
          note_ids: string[]
          starts_at: string
          task_ids: string[]
        }
        Insert: {
          alert_id?: string | null
          alert_readings?: Json
          checked_at?: string
          ends_at: string
          episode_minutes: number
          episode_refs: string[]
          id?: string
          measurement_ids: string[]
          member_id: string
          note_ids?: string[]
          starts_at: string
          task_ids?: string[]
        }
        Update: {
          alert_id?: string | null
          alert_readings?: Json
          checked_at?: string
          ends_at?: string
          episode_minutes?: number
          episode_refs?: string[]
          id?: string
          measurement_ids?: string[]
          member_id?: string
          note_ids?: string[]
          starts_at?: string
          task_ids?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "zoe_bp_staff_items_alert_id_fkey"
            columns: ["alert_id"]
            isOneToOne: false
            referencedRelation: "care_alerts"
            referencedColumns: ["id"]
          },
        ]
      }
      zoe_chat_card_intents: {
        Row: {
          action: string
          card_id: string
          created_at: string
          endpoint_generation: number
          endpoint_id: string
          expires_at: string
          item: Json
          member_id: string
          ref_hash: string
        }
        Insert: {
          action: string
          card_id: string
          created_at?: string
          endpoint_generation: number
          endpoint_id: string
          expires_at: string
          item?: Json
          member_id: string
          ref_hash: string
        }
        Update: {
          action?: string
          card_id?: string
          created_at?: string
          endpoint_generation?: number
          endpoint_id?: string
          expires_at?: string
          item?: Json
          member_id?: string
          ref_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "zoe_chat_card_intents_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "zoe_chat_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "zoe_chat_card_intents_endpoint_id_fkey"
            columns: ["endpoint_id"]
            isOneToOne: false
            referencedRelation: "conversation_endpoints"
            referencedColumns: ["id"]
          },
        ]
      }
      zoe_chat_card_scans: {
        Row: {
          member_id: string
          scanned_at: string
          seq: number
        }
        Insert: {
          member_id: string
          scanned_at?: string
          seq: number
        }
        Update: {
          member_id?: string
          scanned_at?: string
          seq?: number
        }
        Relationships: []
      }
      zoe_chat_card_sends: {
        Row: {
          card_id: string
          created_at: string
          system_message_id: string
        }
        Insert: {
          card_id: string
          created_at?: string
          system_message_id: string
        }
        Update: {
          card_id?: string
          created_at?: string
          system_message_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "zoe_chat_card_sends_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "zoe_chat_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "zoe_chat_card_sends_system_message_id_fkey"
            columns: ["system_message_id"]
            isOneToOne: true
            referencedRelation: "system_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      zoe_chat_cards: {
        Row: {
          claims: Json
          created_at: string
          id: string
          kind: string
          member_id: string
          outcome: Json
          request_id: string
          send_attempts: Json
          snapshot: Json
          source: string
          source_seq: number | null
          state: string
          updated_at: string
        }
        Insert: {
          claims?: Json
          created_at?: string
          id?: string
          kind: string
          member_id: string
          outcome?: Json
          request_id: string
          send_attempts?: Json
          snapshot: Json
          source: string
          source_seq?: number | null
          state?: string
          updated_at?: string
        }
        Update: {
          claims?: Json
          created_at?: string
          id?: string
          kind?: string
          member_id?: string
          outcome?: Json
          request_id?: string
          send_attempts?: Json
          snapshot?: Json
          source?: string
          source_seq?: number | null
          state?: string
          updated_at?: string
        }
        Relationships: []
      }
      zoe_coach_member_state: {
        Row: {
          checkins_paused: boolean
          doctor_resumed_at: string | null
          doctor_resumed_by: string | null
          member_id: string
          paused_at: string | null
          paused_reason: string | null
          updated_at: string
        }
        Insert: {
          checkins_paused?: boolean
          doctor_resumed_at?: string | null
          doctor_resumed_by?: string | null
          member_id: string
          paused_at?: string | null
          paused_reason?: string | null
          updated_at?: string
        }
        Update: {
          checkins_paused?: boolean
          doctor_resumed_at?: string | null
          doctor_resumed_by?: string | null
          member_id?: string
          paused_at?: string | null
          paused_reason?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      zoe_coach_messages: {
        Row: {
          body: string
          conversation_id: string
          created_at: string
          event_id: string
          id: string
          kind: string
          language: string
          member_id: string
          model: string
          provider: string
          run_id: string
        }
        Insert: {
          body: string
          conversation_id: string
          created_at?: string
          event_id: string
          id?: string
          kind: string
          language: string
          member_id: string
          model: string
          provider: string
          run_id: string
        }
        Update: {
          body?: string
          conversation_id?: string
          created_at?: string
          event_id?: string
          id?: string
          kind?: string
          language?: string
          member_id?: string
          model?: string
          provider?: string
          run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "zoe_coach_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "zoe_coach_messages_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: true
            referencedRelation: "coach_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "zoe_coach_messages_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: true
            referencedRelation: "zoe_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      zoe_consents: {
        Row: {
          created_at: string
          granted: boolean
          id: number
          kind: string
          member_id: string
          method: string
          source: string
          text_hash: string | null
          wording_version: string
        }
        Insert: {
          created_at?: string
          granted: boolean
          id?: never
          kind: string
          member_id: string
          method?: string
          source?: string
          text_hash?: string | null
          wording_version: string
        }
        Update: {
          created_at?: string
          granted?: boolean
          id?: never
          kind?: string
          member_id?: string
          method?: string
          source?: string
          text_hash?: string | null
          wording_version?: string
        }
        Relationships: []
      }
      zoe_doctor_mode: {
        Row: {
          changed_at: string
          changed_by: string
          conversation_id: string
          doctor_mode: boolean
          member_id: string
          reason: string
        }
        Insert: {
          changed_at?: string
          changed_by: string
          conversation_id: string
          doctor_mode: boolean
          member_id: string
          reason: string
        }
        Update: {
          changed_at?: string
          changed_by?: string
          conversation_id?: string
          doctor_mode?: boolean
          member_id?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "zoe_doctor_mode_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: true
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      zoe_eval_runs: {
        Row: {
          created_at: string
          failed_ids: string[]
          failures: number
          fallback_model_id: string | null
          harness_version: string
          id: string
          mode: string
          model_id: string
          must_failures: number
          requested_by: string
          tier: string
          total_rows: number
          used_at: string | null
        }
        Insert: {
          created_at?: string
          failed_ids?: string[]
          failures: number
          fallback_model_id?: string | null
          harness_version: string
          id?: string
          mode: string
          model_id: string
          must_failures: number
          requested_by: string
          tier: string
          total_rows: number
          used_at?: string | null
        }
        Update: {
          created_at?: string
          failed_ids?: string[]
          failures?: number
          fallback_model_id?: string | null
          harness_version?: string
          id?: string
          mode?: string
          model_id?: string
          must_failures?: number
          requested_by?: string
          tier?: string
          total_rows?: number
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "zoe_eval_runs_fallback_model_id_fkey"
            columns: ["fallback_model_id"]
            isOneToOne: false
            referencedRelation: "zoe_model_catalog"
            referencedColumns: ["model_id"]
          },
          {
            foreignKeyName: "zoe_eval_runs_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "zoe_model_catalog"
            referencedColumns: ["model_id"]
          },
        ]
      }
      zoe_member_answers: {
        Row: {
          body: string
          conversation_id: string
          created_at: string
          id: string
          kind: string
          language: string
          member_id: string
          message_seq: number
          model: string
          provider: string
          run_id: string
          system_message_id: string | null
        }
        Insert: {
          body: string
          conversation_id: string
          created_at?: string
          id?: string
          kind?: string
          language: string
          member_id: string
          message_seq: number
          model: string
          provider: string
          run_id: string
          system_message_id?: string | null
        }
        Update: {
          body?: string
          conversation_id?: string
          created_at?: string
          id?: string
          kind?: string
          language?: string
          member_id?: string
          message_seq?: number
          model?: string
          provider?: string
          run_id?: string
          system_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "zoe_member_answers_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "zoe_member_answers_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: true
            referencedRelation: "zoe_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "zoe_member_answers_system_message_id_fkey"
            columns: ["system_message_id"]
            isOneToOne: false
            referencedRelation: "system_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      zoe_mode_notices: {
        Row: {
          body: string
          conversation_id: string
          created_at: string
          id: string
          kind: string
          language: string
          member_id: string
          system_message_id: string | null
        }
        Insert: {
          body: string
          conversation_id: string
          created_at?: string
          id?: string
          kind: string
          language: string
          member_id: string
          system_message_id?: string | null
        }
        Update: {
          body?: string
          conversation_id?: string
          created_at?: string
          id?: string
          kind?: string
          language?: string
          member_id?: string
          system_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "zoe_mode_notices_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "zoe_mode_notices_system_message_id_fkey"
            columns: ["system_message_id"]
            isOneToOne: false
            referencedRelation: "system_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      zoe_model_catalog: {
        Row: {
          added_at: string
          enabled: boolean
          input_usd_per_mtok: number
          label: string
          model_id: string
          output_usd_per_mtok: number
          provider: string
          strength: number
        }
        Insert: {
          added_at?: string
          enabled?: boolean
          input_usd_per_mtok: number
          label: string
          model_id: string
          output_usd_per_mtok: number
          provider: string
          strength: number
        }
        Update: {
          added_at?: string
          enabled?: boolean
          input_usd_per_mtok?: number
          label?: string
          model_id?: string
          output_usd_per_mtok?: number
          provider?: string
          strength?: number
        }
        Relationships: [
          {
            foreignKeyName: "zoe_model_catalog_provider_fkey"
            columns: ["provider"]
            isOneToOne: false
            referencedRelation: "zoe_model_providers"
            referencedColumns: ["provider"]
          },
        ]
      }
      zoe_model_eval_jobs: {
        Row: {
          error_code: string | null
          eval_run_id: string | null
          finished_at: string | null
          id: string
          model_id: string
          requested_by: string
          started_at: string
          status: string
          tier: string
        }
        Insert: {
          error_code?: string | null
          eval_run_id?: string | null
          finished_at?: string | null
          id?: string
          model_id: string
          requested_by: string
          started_at?: string
          status?: string
          tier: string
        }
        Update: {
          error_code?: string | null
          eval_run_id?: string | null
          finished_at?: string | null
          id?: string
          model_id?: string
          requested_by?: string
          started_at?: string
          status?: string
          tier?: string
        }
        Relationships: [
          {
            foreignKeyName: "zoe_model_eval_jobs_eval_run_id_fkey"
            columns: ["eval_run_id"]
            isOneToOne: false
            referencedRelation: "zoe_eval_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "zoe_model_eval_jobs_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "zoe_model_catalog"
            referencedColumns: ["model_id"]
          },
        ]
      }
      zoe_model_providers: {
        Row: {
          data_agreement: string
          label: string
          provider: string
        }
        Insert: {
          data_agreement?: string
          label: string
          provider: string
        }
        Update: {
          data_agreement?: string
          label?: string
          provider?: string
        }
        Relationships: []
      }
      zoe_practice_marks: {
        Row: {
          author: string
          correction: string
          created_at: string
          id: string
          rating: string
          reason: string
          session_id: string
          snapshot: Json
          turn_id: string
          updated_at: string
        }
        Insert: {
          author: string
          correction?: string
          created_at?: string
          id?: string
          rating: string
          reason?: string
          session_id: string
          snapshot: Json
          turn_id: string
          updated_at?: string
        }
        Update: {
          author?: string
          correction?: string
          created_at?: string
          id?: string
          rating?: string
          reason?: string
          session_id?: string
          snapshot?: Json
          turn_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "zoe_practice_marks_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "zoe_practice_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      zoe_practice_sessions: {
        Row: {
          author: string
          created_at: string
          id: string
          lease: string | null
          lease_until: string | null
          patient_id: string
          reservations: Json
          state: Json
          turn_versions: Json
          version: number
        }
        Insert: {
          author: string
          created_at?: string
          id?: string
          lease?: string | null
          lease_until?: string | null
          patient_id: string
          reservations?: Json
          state: Json
          turn_versions?: Json
          version?: number
        }
        Update: {
          author?: string
          created_at?: string
          id?: string
          lease?: string | null
          lease_until?: string | null
          patient_id?: string
          reservations?: Json
          state?: Json
          turn_versions?: Json
          version?: number
        }
        Relationships: []
      }
      zoe_reply_drafts: {
        Row: {
          acknowledgement: string
          acknowledgement_id: string
          asked: string
          clinical_revision: number
          created_at: string
          doctor_decides: string[]
          judgement_reasons: string[]
          member_id: string
          needs_judgement: boolean
          outside_plan: boolean
          plan_id: string | null
          plan_published_at: string | null
          quoted: Json
          run_id: string
          source_token: string
          version: string
        }
        Insert: {
          acknowledgement: string
          acknowledgement_id: string
          asked: string
          clinical_revision: number
          created_at?: string
          doctor_decides?: string[]
          judgement_reasons?: string[]
          member_id: string
          needs_judgement: boolean
          outside_plan: boolean
          plan_id?: string | null
          plan_published_at?: string | null
          quoted: Json
          run_id: string
          source_token: string
          version: string
        }
        Update: {
          acknowledgement?: string
          acknowledgement_id?: string
          asked?: string
          clinical_revision?: number
          created_at?: string
          doctor_decides?: string[]
          judgement_reasons?: string[]
          member_id?: string
          needs_judgement?: boolean
          outside_plan?: boolean
          plan_id?: string | null
          plan_published_at?: string | null
          quoted?: Json
          run_id?: string
          source_token?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "zoe_reply_drafts_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "patient_care_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "zoe_reply_drafts_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: true
            referencedRelation: "zoe_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      zoe_runs: {
        Row: {
          config_version: string | null
          context_version: number
          conversation_id: string
          cost_usd: number | null
          draft_epoch: number
          draft_id: string | null
          estimate_usd: number
          fallback_used: boolean
          finished_at: string | null
          forward: string | null
          forward_reason: string | null
          guard_reasons: string[]
          id: string
          injection_detected: boolean
          input_tokens: number | null
          kind: string
          latency_ms: number | null
          member_id: string
          message_seq: number | null
          model: string | null
          outcome: string | null
          output_tokens: number | null
          provider: string | null
          reason_code: string | null
          redaction_count: number
          reserved: boolean
          sealed_io: string | null
          spend_day: string
          started_at: string
          state: string
          summary: string | null
          tier: string | null
          tier_reason: string | null
          topic_owner: string | null
          topic_start_seq: number | null
          urgent_checked_at: string | null
          why: Json | null
        }
        Insert: {
          config_version?: string | null
          context_version: number
          conversation_id: string
          cost_usd?: number | null
          draft_epoch: number
          draft_id?: string | null
          estimate_usd?: number
          fallback_used?: boolean
          finished_at?: string | null
          forward?: string | null
          forward_reason?: string | null
          guard_reasons?: string[]
          id?: string
          injection_detected?: boolean
          input_tokens?: number | null
          kind?: string
          latency_ms?: number | null
          member_id: string
          message_seq?: number | null
          model?: string | null
          outcome?: string | null
          output_tokens?: number | null
          provider?: string | null
          reason_code?: string | null
          redaction_count?: number
          reserved?: boolean
          sealed_io?: string | null
          spend_day: string
          started_at?: string
          state?: string
          summary?: string | null
          tier?: string | null
          tier_reason?: string | null
          topic_owner?: string | null
          topic_start_seq?: number | null
          urgent_checked_at?: string | null
          why?: Json | null
        }
        Update: {
          config_version?: string | null
          context_version?: number
          conversation_id?: string
          cost_usd?: number | null
          draft_epoch?: number
          draft_id?: string | null
          estimate_usd?: number
          fallback_used?: boolean
          finished_at?: string | null
          forward?: string | null
          forward_reason?: string | null
          guard_reasons?: string[]
          id?: string
          injection_detected?: boolean
          input_tokens?: number | null
          kind?: string
          latency_ms?: number | null
          member_id?: string
          message_seq?: number | null
          model?: string | null
          outcome?: string | null
          output_tokens?: number | null
          provider?: string | null
          reason_code?: string | null
          redaction_count?: number
          reserved?: boolean
          sealed_io?: string | null
          spend_day?: string
          started_at?: string
          state?: string
          summary?: string | null
          tier?: string | null
          tier_reason?: string | null
          topic_owner?: string | null
          topic_start_seq?: number | null
          urgent_checked_at?: string | null
          why?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "zoe_runs_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "zoe_runs_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "conversation_drafts"
            referencedColumns: ["id"]
          },
        ]
      }
      zoe_settings: {
        Row: {
          coach_checkins_wording_version: string | null
          coach_daily_max: number
          coach_enabled: boolean
          coach_weekly_max: number
          coach_window_end: string
          coach_window_start: string
          consent_collection_enabled: boolean
          consent_wording_also_valid: string[]
          consent_wording_version: string | null
          conversational_replies_enabled: boolean
          daily_spend_cap_usd: number
          direct_answers_enabled: boolean
          doctor_takeover_scope: string
          health_answers_enabled: boolean
          member_daily_cap_usd: number
          memory_wording_version: string | null
          model_calls_allowed: boolean
          quiet_end: string
          quiet_start: string
          scheduled_daily_max: number
          singleton: boolean
          staging_ai_mode: boolean
          structured_drafts_enabled: boolean
          symptom_intake_enabled: boolean
          time_zone: string
          updated_at: string
        }
        Insert: {
          coach_checkins_wording_version?: string | null
          coach_daily_max?: number
          coach_enabled?: boolean
          coach_weekly_max?: number
          coach_window_end?: string
          coach_window_start?: string
          consent_collection_enabled?: boolean
          consent_wording_also_valid?: string[]
          consent_wording_version?: string | null
          conversational_replies_enabled?: boolean
          daily_spend_cap_usd?: number
          direct_answers_enabled?: boolean
          doctor_takeover_scope?: string
          health_answers_enabled?: boolean
          member_daily_cap_usd?: number
          memory_wording_version?: string | null
          model_calls_allowed?: boolean
          quiet_end?: string
          quiet_start?: string
          scheduled_daily_max?: number
          singleton?: boolean
          staging_ai_mode?: boolean
          structured_drafts_enabled?: boolean
          symptom_intake_enabled?: boolean
          time_zone?: string
          updated_at?: string
        }
        Update: {
          coach_checkins_wording_version?: string | null
          coach_daily_max?: number
          coach_enabled?: boolean
          coach_weekly_max?: number
          coach_window_end?: string
          coach_window_start?: string
          consent_collection_enabled?: boolean
          consent_wording_also_valid?: string[]
          consent_wording_version?: string | null
          conversational_replies_enabled?: boolean
          daily_spend_cap_usd?: number
          direct_answers_enabled?: boolean
          doctor_takeover_scope?: string
          health_answers_enabled?: boolean
          member_daily_cap_usd?: number
          memory_wording_version?: string | null
          model_calls_allowed?: boolean
          quiet_end?: string
          quiet_start?: string
          scheduled_daily_max?: number
          singleton?: boolean
          staging_ai_mode?: boolean
          structured_drafts_enabled?: boolean
          symptom_intake_enabled?: boolean
          time_zone?: string
          updated_at?: string
        }
        Relationships: []
      }
      zoe_symptom_intake_notices: {
        Row: {
          created_at: string
          intake_id: string
          recipient_id: string
          recipient_role: string
          telegram_message_id: string
        }
        Insert: {
          created_at?: string
          intake_id: string
          recipient_id: string
          recipient_role: string
          telegram_message_id: string
        }
        Update: {
          created_at?: string
          intake_id?: string
          recipient_id?: string
          recipient_role?: string
          telegram_message_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "zoe_symptom_intake_notices_intake_id_fkey"
            columns: ["intake_id"]
            isOneToOne: false
            referencedRelation: "zoe_symptom_intakes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "zoe_symptom_intake_notices_telegram_message_id_fkey"
            columns: ["telegram_message_id"]
            isOneToOne: true
            referencedRelation: "telegram_auth_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      zoe_symptom_intakes: {
        Row: {
          conversation_id: string
          created_at: string
          ending: string | null
          finished_at: string | null
          id: string
          language: string
          last_run_id: string | null
          last_seq: number
          member_id: string
          record: Json
          sheet_id: string
          sheet_version: number
          started_seq: number
          state: string
          summary: Json | null
          updated_at: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          ending?: string | null
          finished_at?: string | null
          id?: string
          language: string
          last_run_id?: string | null
          last_seq: number
          member_id: string
          record: Json
          sheet_id: string
          sheet_version: number
          started_seq: number
          state?: string
          summary?: Json | null
          updated_at?: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          ending?: string | null
          finished_at?: string | null
          id?: string
          language?: string
          last_run_id?: string | null
          last_seq?: number
          member_id?: string
          record?: Json
          sheet_id?: string
          sheet_version?: number
          started_seq?: number
          state?: string
          summary?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "zoe_symptom_intakes_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "zoe_symptom_intakes_last_run_id_fkey"
            columns: ["last_run_id"]
            isOneToOne: false
            referencedRelation: "zoe_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "zoe_symptom_intakes_sheet_id_sheet_version_fkey"
            columns: ["sheet_id", "sheet_version"]
            isOneToOne: false
            referencedRelation: "zoe_symptom_sheets"
            referencedColumns: ["sheet_id", "version"]
          },
        ]
      }
      zoe_symptom_sheets: {
        Row: {
          registered_at: string
          sheet_id: string
          signed_at: string | null
          signed_by: string | null
          status: string
          version: number
        }
        Insert: {
          registered_at?: string
          sheet_id: string
          signed_at?: string | null
          signed_by?: string | null
          status?: string
          version: number
        }
        Update: {
          registered_at?: string
          sheet_id?: string
          signed_at?: string | null
          signed_by?: string | null
          status?: string
          version?: number
        }
        Relationships: []
      }
      zoe_tier_config: {
        Row: {
          daily_cap_usd: number
          fallback_model_id: string | null
          model_id: string
          tier: string
          updated_at: string
          updated_by: string | null
          version: number
        }
        Insert: {
          daily_cap_usd: number
          fallback_model_id?: string | null
          model_id: string
          tier: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Update: {
          daily_cap_usd?: number
          fallback_model_id?: string | null
          model_id?: string
          tier?: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "zoe_tier_config_fallback_model_id_fkey"
            columns: ["fallback_model_id"]
            isOneToOne: false
            referencedRelation: "zoe_model_catalog"
            referencedColumns: ["model_id"]
          },
          {
            foreignKeyName: "zoe_tier_config_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "zoe_model_catalog"
            referencedColumns: ["model_id"]
          },
        ]
      }
      zoe_tier_config_changes: {
        Row: {
          action: string
          actor: string
          after: Json
          before: Json
          created_at: string
          eval_run_id: string | null
          id: number
          reason: string | null
          rolled_back_change_id: number | null
          tier: string
        }
        Insert: {
          action: string
          actor: string
          after: Json
          before: Json
          created_at?: string
          eval_run_id?: string | null
          id?: never
          reason?: string | null
          rolled_back_change_id?: number | null
          tier: string
        }
        Update: {
          action?: string
          actor?: string
          after?: Json
          before?: Json
          created_at?: string
          eval_run_id?: string | null
          id?: never
          reason?: string | null
          rolled_back_change_id?: number | null
          tier?: string
        }
        Relationships: [
          {
            foreignKeyName: "zoe_tier_config_changes_eval_run_id_fkey"
            columns: ["eval_run_id"]
            isOneToOne: true
            referencedRelation: "zoe_eval_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "zoe_tier_config_changes_rolled_back_change_id_fkey"
            columns: ["rolled_back_change_id"]
            isOneToOne: false
            referencedRelation: "zoe_tier_config_changes"
            referencedColumns: ["id"]
          },
        ]
      }
      zoe_urgent_clears: {
        Row: {
          cleared_at: string
          cleared_by: string
          conversation_id: string
          id: string
          member_id: string
          opened_by: string
          window_started_at: string
        }
        Insert: {
          cleared_at?: string
          cleared_by: string
          conversation_id: string
          id?: string
          member_id: string
          opened_by: string
          window_started_at: string
        }
        Update: {
          cleared_at?: string
          cleared_by?: string
          conversation_id?: string
          id?: string
          member_id?: string
          opened_by?: string
          window_started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "zoe_urgent_clears_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      zoe_v3_medicine_saves: {
        Row: {
          card_id: string
          created_at: string
          member_id: string
          rows: Json
          stops: Json
        }
        Insert: {
          card_id: string
          created_at?: string
          member_id: string
          rows: Json
          stops: Json
        }
        Update: {
          card_id?: string
          created_at?: string
          member_id?: string
          rows?: Json
          stops?: Json
        }
        Relationships: [
          {
            foreignKeyName: "zoe_v3_medicine_saves_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: true
            referencedRelation: "zoe_chat_cards"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _access_audit_record: {
        Args: { p_member: string; p_object?: string; p_surface: string }
        Returns: undefined
      }
      _access_audit_record_as: {
        Args: {
          p_actor: string
          p_binding: string
          p_generation: number
          p_member: string
          p_object?: string
          p_surface: string
        }
        Returns: undefined
      }
      _admin_conversation_read_on: { Args: never; Returns: boolean }
      _ai_cap_room: {
        Args: { p_cap: number; p_estimate: number; p_spent: number }
        Returns: boolean
      }
      _ai_plan_enabled: { Args: never; Returns: boolean }
      _ai_plan_lab_token: { Args: { p_user: string }; Returns: string }
      _ai_spend: {
        Args: { p_day: string; p_tier: string }
        Returns: {
          tier_total: number
          total: number
        }[]
      }
      _assert_required_lab_receipt: {
        Args: { p_test: string; p_user: string; p_values: Json }
        Returns: undefined
      }
      _assigned_active_doctor: { Args: { p_user: string }; Returns: string }
      _audit_clinic_category: { Args: { p_kind: string }; Returns: string }
      _audit_clinic_scope: {
        Args: { p_clinic: string }
        Returns: {
          id: string
          kind: string
        }[]
      }
      _audit_page: {
        Args: {
          p_actor: string
          p_category: string
          p_clinic?: string
          p_cursor: string
          p_from: string
          p_limit: number
          p_member: string
          p_to: string
        }
        Returns: Json
      }
      _audit_people: { Args: { p_clinic?: string }; Returns: Json }
      _audit_profile_page: {
        Args: {
          p_actor: string
          p_category: string
          p_clinic: string
          p_cursor: string
          p_from: string
          p_limit: number
          p_member: string
          p_to: string
        }
        Returns: Json
      }
      _audit_rows: {
        Args: {
          p_actor: string
          p_category: string
          p_from: string
          p_member: string
          p_to: string
        }
        Returns: {
          action: string
          actor_id: string
          at: string
          category: string
          key: string
          member_id: string
          ref: string
          source: string
        }[]
      }
      _audit_source_rows: {
        Args: {
          p_actor: string
          p_category: string
          p_from: string
          p_member: string
          p_to: string
        }
        Returns: {
          action: string
          actor_id: string
          at: string
          category: string
          key: string
          member_id: string
          ref: string
          source: string
        }[]
      }
      _auth_phone: { Args: { u: string }; Returns: string }
      _auth_user_for_phone: { Args: { p: string }; Returns: string }
      _auto_assign_doctor: { Args: never; Returns: string }
      _auto_assign_nurse: { Args: { p_doctor: string }; Returns: string }
      _booking_appointment_dto: {
        Args: {
          p_row: Database["public"]["Tables"]["booking_appointments"]["Row"]
        }
        Returns: Json
      }
      _booking_assert_actor: {
        Args: { p_actor: string; p_member: string }
        Returns: undefined
      }
      _booking_envelope_hash: {
        Args: {
          p_clinic: string
          p_copy: string
          p_sender: string
          p_subject: string
          p_template: string
          p_text: string
        }
        Returns: string
      }
      _booking_notice_context: {
        Args: {
          p_engine: string
          p_notice: string
          p_sender: string
          p_template: string
        }
        Returns: boolean
      }
      _booking_offer_coverage: {
        Args: { p_offer: Json; p_program: Json }
        Returns: boolean
      }
      _booking_offer_project: {
        Args: { p_offer: Json; p_program: Json }
        Returns: Json
      }
      _booking_portal_details: { Args: { mm: string }; Returns: Json }
      _booking_visit_attended: {
        Args: { p_reservation: string }
        Returns: boolean
      }
      _booking_visit_missed: {
        Args: { p_reservation: string }
        Returns: boolean
      }
      _booking_visit_open: {
        Args: {
          p_row: Database["public"]["Tables"]["booking_appointments"]["Row"]
        }
        Returns: boolean
      }
      _bp_actor: {
        Args: never
        Returns: {
          active: boolean
          clinic_id: string | null
          created_at: string
          display_name: string
          management_revision: number
          removed_at: string | null
          role: string
          sees_test_members: boolean
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "workspace_staff"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _bp_assignment_at: {
        Args: { p_at: string; p_device: string }
        Returns: {
          assign_reason: string | null
          assigned_at: string
          assigned_by: string
          assigned_by_name: string
          assigned_by_role: string
          device_id: string
          end_reason: string | null
          ended_at: string | null
          ended_by: string | null
          ended_by_name: string | null
          ended_by_role: string | null
          ended_recorded_at: string | null
          id: string
          member_id: string
          recorded_at: string
        }
        SetofOptions: {
          from: "*"
          to: "bp_device_assignments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _bp_assignment_json: {
        Args: {
          a: Database["public"]["Tables"]["bp_device_assignments"]["Row"]
        }
        Returns: Json
      }
      _bp_check_level: {
        Args: { by_staff: boolean; d: number; repeated: boolean; s: number }
        Returns: string
      }
      _bp_check_note: {
        Args: {
          m: Database["public"]["Tables"]["patient_measurements"]["Row"]
          p_close: boolean
          p_open: boolean
        }
        Returns: undefined
      }
      _bp_check_raise: {
        Args: {
          p_level: string
          p_measured_at: string
          p_member: string
          p_ref: string
        }
        Returns: boolean
      }
      _bp_device_json: {
        Args: { d: Database["public"]["Tables"]["bp_devices"]["Row"] }
        Returns: Json
      }
      _bp_reading_guard: {
        Args: { p_at: string; p_claimed: string; p_device: string }
        Returns: Record<string, unknown>
      }
      _bp_week_json: {
        Args: { w: Database["public"]["Tables"]["bp_weeks"]["Row"] }
        Returns: Json
      }
      _bp_week_member_read: { Args: { uid: string }; Returns: Json }
      _bp_week_record: {
        Args: {
          p_diastolic: number
          p_measured_at: string
          p_pulse: number
          p_slot: string
          p_submission: string
          p_systolic: number
          p_week: string
          uid: string
        }
        Returns: Json
      }
      _bp_week_staff_read_body: { Args: { p_member: string }; Returns: Json }
      _bp_week_today: { Args: never; Returns: string }
      _bp_weekly_summary_params: {
        Args: { p_locale: string; p_summary: Json }
        Returns: Json
      }
      _bp_weekly_trend: {
        Args: { p_member: string; p_now: string }
        Returns: Json
      }
      _care_alert_actor: { Args: never; Returns: Json }
      _care_alert_backfill_open_routes: { Args: never; Returns: number }
      _care_alert_backfill_owner_routes: { Args: never; Returns: number }
      _care_alert_current_screening: {
        Args: { m: string; rule: string }
        Returns: {
          alert_id: string | null
          member_id: string
          outcome: string
          reason_code: string
          red_flags: string[]
          rule_id: string
          rule_version: string
          screened_at: string
          source: string
          source_ref: string
        }
        SetofOptions: {
          from: "*"
          to: "care_alert_screenings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _care_alert_json: {
        Args: { a: Database["public"]["Tables"]["care_alerts"]["Row"] }
        Returns: Json
      }
      _care_alert_lock: {
        Args: { p_alert: string }
        Returns: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          created_at: string
          cycle_started_at: string
          doctor_id: string | null
          escalated_at: string | null
          escalated_to: string | null
          escalation_attempted_at: string | null
          escalation_notified_at: string | null
          id: string
          last_seen_at: string
          member_id: string
          next_action: string | null
          next_action_at: string | null
          next_action_by: string | null
          next_action_due_at: string | null
          occurrences: number
          priority: string
          reason_code: string
          red_flags: string[]
          resolution: string | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          route_backup: string | null
          route_minutes: number | null
          route_primary: string | null
          rule_id: string
          rule_version: string
          source: string
          source_ref: string
          state: string
          state_seq: number
        }
        SetofOptions: {
          from: "*"
          to: "care_alerts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _care_alert_notify: {
        Args: { a: Database["public"]["Tables"]["care_alerts"]["Row"] }
        Returns: undefined
      }
      _care_alert_owner: { Args: { p_member: string }; Returns: Json }
      _care_alert_ownership: {
        Args: { a: Database["public"]["Tables"]["care_alerts"]["Row"] }
        Returns: Json
      }
      _care_alert_raise: {
        Args: {
          p_member: string
          p_reason: string
          p_red_flags: string[]
          p_rule: string
          p_rule_version: string
          p_source: string
          p_source_ref: string
        }
        Returns: string
      }
      _care_alert_route: {
        Args: { p_source: string }
        Returns: {
          backup_role: string | null
          escalate_after_minutes: number | null
          primary_role: string
          source: string
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "care_alert_routing"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _care_alert_screen: {
        Args: {
          p_member: string
          p_outcome: string
          p_reason: string
          p_red_flags: string[]
          p_rule: string
          p_rule_version: string
          p_source: string
          p_source_ref: string
        }
        Returns: Json
      }
      _care_alert_screen_assessment: {
        Args: { a: Database["public"]["Tables"]["patient_assessments"]["Row"] }
        Returns: Json
      }
      _care_alert_settings: {
        Args: never
        Returns: {
          enabled: boolean
          sandbox_test_accounts: boolean
          singleton: boolean
          telegram_delivery: boolean
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "care_alert_settings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _care_alert_trace: {
        Args: {
          a: Database["public"]["Tables"]["care_alerts"]["Row"]
          p_actor: string
          p_actor_kind: string
          p_attrs: Json
          p_name: string
          p_outcome: string
          p_reason: string
        }
        Returns: undefined
      }
      _care_alert_visible: {
        Args: {
          a: Database["public"]["Tables"]["care_alerts"]["Row"]
          actor: Json
        }
        Returns: boolean
      }
      _care_queue_actor: { Args: never; Returns: Json }
      _care_queue_eligible: {
        Args: { p_role: string; p_user: string }
        Returns: boolean
      }
      _care_queue_json: {
        Args: { t: Database["public"]["Tables"]["care_queue_tasks"]["Row"] }
        Returns: Json
      }
      _care_queue_mark_result: {
        Args: {
          p_code: string
          p_ok: boolean
          t: Database["public"]["Tables"]["care_queue_tasks"]["Row"]
        }
        Returns: Json
      }
      _care_queue_reopen_merge_closed: { Args: never; Returns: number }
      _care_queue_visible: {
        Args: {
          actor: Json
          t: Database["public"]["Tables"]["care_queue_tasks"]["Row"]
        }
        Returns: boolean
      }
      _care_team_reconcile: {
        Args: {
          p_actor: string
          p_member: string
          p_request: string
          p_via: string
        }
        Returns: undefined
      }
      _channel_inbox_finish: {
        Args: { i: string; r: string; st: string }
        Returns: Json
      }
      _channel_inbox_press_refused: {
        Args: {
          m: string
          p_code: string
          r: Database["public"]["Tables"]["channel_inbox"]["Row"]
        }
        Returns: Json
      }
      _channel_inbox_receive_callback: {
        Args: { r: Database["public"]["Tables"]["channel_inbox"]["Row"] }
        Returns: Json
      }
      _channel_inbox_receive_media: {
        Args: { r: Database["public"]["Tables"]["channel_inbox"]["Row"] }
        Returns: Json
      }
      _channel_inbox_receive_menu: {
        Args: { r: Database["public"]["Tables"]["channel_inbox"]["Row"] }
        Returns: Json
      }
      _channel_inbox_receive_redo: {
        Args: { r: Database["public"]["Tables"]["channel_inbox"]["Row"] }
        Returns: Json
      }
      _channel_inbox_receive_text: {
        Args: { r: Database["public"]["Tables"]["channel_inbox"]["Row"] }
        Returns: Json
      }
      _channel_text_is_menu: { Args: { t: string }; Returns: boolean }
      _clinic_admin_booked: {
        Args: { c: string; mm: string }
        Returns: boolean
      }
      _clinic_admin_change_decide: {
        Args: {
          p_clinic: string
          p_decision: string
          p_note: string
          p_platform: boolean
          p_request: string
        }
        Returns: Json
      }
      _clinic_admin_change_json: {
        Args: {
          p_full_dates: boolean
          r: Database["public"]["Tables"]["clinic_admin_change_requests"]["Row"]
        }
        Returns: Json
      }
      _clinic_admin_change_list: {
        Args: { p_clinic: string; p_full_dates: boolean; p_state: string }
        Returns: Json
      }
      _clinic_admin_change_prepare: {
        Args: {
          p_clinic: string
          p_expected: Json
          p_kind: string
          p_member: string
          p_proposed: Json
        }
        Returns: Json
      }
      _clinic_admin_full_access_enabled: { Args: never; Returns: boolean }
      _clinic_admin_member: {
        Args: { c: string }
        Returns: {
          active: boolean
          clinic_id: string
          display_name: string
          id: string
          revision: number
          role: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "clinic_portal_memberships"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _clinic_admin_member_file_attach_core: {
        Args: {
          p_appointment?: string
          p_clinic: string
          p_confirm?: boolean
          p_file: string
          p_member: string
          p_reason?: string
          p_submission: string
        }
        Returns: Json
      }
      _clinic_admin_patient: {
        Args: { c: string; mm: string }
        Returns: boolean
      }
      _clinic_admin_patients: {
        Args: { c: string }
        Returns: {
          member_id: string
        }[]
      }
      _clinic_admin_staff_json: { Args: { s: string }; Returns: Json }
      _clinic_attach_refusal: {
        Args: { p_file: string; p_member: string }
        Returns: string
      }
      _clinic_invitation_json: {
        Args: {
          i: Database["public"]["Tables"]["clinic_portal_invitations"]["Row"]
        }
        Returns: Json
      }
      _clinic_invitation_retire: {
        Args: {
          i: Database["public"]["Tables"]["clinic_portal_invitations"]["Row"]
        }
        Returns: undefined
      }
      _clinic_invite_binding: {
        Args: {
          i: Database["public"]["Tables"]["clinic_portal_invitations"]["Row"]
        }
        Returns: {
          account_ref: string
          active: boolean
          address: string
          auth_user_id: string
          created_at: string
          generation: number
          id: string
          kind: string
          pending_clinic_invitation_id: string | null
          pending_invitation_id: string | null
          phone: string
          principal_ref: string
          proven_at: string
          proven_by: string | null
          revoked_at: string | null
          revoked_reason: string | null
        }
        SetofOptions: {
          from: "clinic_portal_invitations"
          to: "telegram_auth_bindings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _clinic_invite_open: {
        Args: { p_generation: number; p_invitation_id: string }
        Returns: {
          accepted_at: string | null
          auth_user_id: string | null
          clinic_id: string
          created_at: string
          display_name: string
          email: string
          expires_at: string
          generation: number
          id: string
          invited_phone: string
          issuer_id: string
          membership_id: string | null
          request_id: string
          status: string
          verified_at: string | null
          verified_binding_id: string | null
          verified_nonce_hmac: string | null
        }
        SetofOptions: {
          from: "*"
          to: "clinic_portal_invitations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _clinic_known_members: {
        Args: { c: string }
        Returns: {
          member_id: string
        }[]
      }
      _clinic_lab_receipt_values: {
        Args: { p_attachment: string; p_ids: Json; p_user: string }
        Returns: Json
      }
      _clinic_member_assigned_here: {
        Args: { c: string; mm: string }
        Returns: boolean
      }
      _clinic_member_attach: {
        Args: {
          p_actor: string
          p_actor_name: string
          p_appointment: string
          p_clinic: string
          p_file: string
          p_member: string
          p_membership: string
          p_sub: string
        }
        Returns: Json
      }
      _clinic_member_comparison_masked: {
        Args: { p_compare: Json }
        Returns: Json
      }
      _clinic_member_file_check: {
        Args: { p_clinic: string; p_file: string; p_member: string }
        Returns: Json
      }
      _clinic_member_file_compare: {
        Args: { p_file: string; p_member: string }
        Returns: Json
      }
      _clinic_member_file_json: {
        Args: {
          c: string
          f: Database["public"]["Tables"]["clinic_batch_files"]["Row"]
          mm: string
          p_state: string
          p_upload: boolean
        }
        Returns: Json
      }
      _clinic_member_files: { Args: { c: string; mm: string }; Returns: Json }
      _clinic_member_identity_masked: {
        Args: { p_identity: Json }
        Returns: Json
      }
      _clinic_member_known: { Args: { c: string; m: string }; Returns: boolean }
      _clinic_member_phone: { Args: { m: string }; Returns: string }
      _clinic_member_upload_try: { Args: { p_file: string }; Returns: string }
      _clinic_member_visits: { Args: { c: string; mm: string }; Returns: Json }
      _clinic_portal_account_reason: { Args: { u: unknown }; Returns: string }
      _clinic_portal_admin: { Args: never; Returns: string }
      _clinic_portal_admin_command: { Args: { p: Json }; Returns: Json }
      _clinic_portal_admin_lock: {
        Args: { a: string; r: string }
        Returns: undefined
      }
      _clinic_portal_batch_json: {
        Args: { b: Database["public"]["Tables"]["clinic_batches"]["Row"] }
        Returns: Json
      }
      _clinic_portal_command: { Args: { p: Json }; Returns: Json }
      _clinic_portal_command_lock: {
        Args: { a: string; r: string }
        Returns: undefined
      }
      _clinic_portal_file_json: {
        Args: { f: Database["public"]["Tables"]["clinic_batch_files"]["Row"] }
        Returns: Json
      }
      _clinic_portal_file_lock: {
        Args: { original_authority: boolean; p_file: string }
        Returns: {
          actor_id: string
          amr: Json
          attempt_id: string
          batch_id: string
          cleanup: string
          created_at: string
          declared_size: number
          execution: string
          expected_sha256: string
          id: string
          jwt_expires_at: string
          logical_key: string
          measured_size: number | null
          membership_id: string
          membership_revision: number
          mime: string
          name: string
          object_id: string | null
          object_key: string
          revision: number
          session_id: string
          sha256: string | null
          state: string
          submission_id: string
        }
        SetofOptions: {
          from: "*"
          to: "clinic_batch_files"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _clinic_portal_lab_link_core: {
        Args: { p_clinic: string; p_command: Json }
        Returns: Json
      }
      _clinic_portal_live: {
        Args: {
          a: string
          amr: Json
          c: string
          expires: string
          mid?: string
          mrev?: number
          s: string
        }
        Returns: {
          active: boolean
          clinic_id: string
          display_name: string
          id: string
          revision: number
          role: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "clinic_portal_memberships"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _clinic_portal_membership_json: {
        Args: {
          m: Database["public"]["Tables"]["clinic_portal_memberships"]["Row"]
        }
        Returns: Json
      }
      _clinic_portal_user: {
        Args: { c: string }
        Returns: {
          active: boolean
          clinic_id: string
          display_name: string
          id: string
          revision: number
          role: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "clinic_portal_memberships"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _clinic_profile_apply: {
        Args: { p_backfill: boolean; p_request: string }
        Returns: Json
      }
      _clinic_proposal_notify: { Args: { p_member: string }; Returns: string }
      _clinic_result_apply: {
        Args: {
          a: Database["public"]["Tables"]["clinic_result_attachments"]["Row"]
          f: Database["public"]["Tables"]["clinic_batch_files"]["Row"]
        }
        Returns: Json
      }
      _clinic_result_attach: {
        Args: {
          p_actor: string
          p_clinic_only: string
          p_file: string
          p_kind: string
          p_member: string
          p_sub: string
          p_visit: string
        }
        Returns: Json
      }
      _clinic_result_attach_core: {
        Args: {
          p_actor: string
          p_clinic_only: string
          p_file: string
          p_kind: string
          p_member: string
          p_sub: string
          p_visit: string
        }
        Returns: Json
      }
      _clinic_result_current: {
        Args: { p_file: string }
        Returns: {
          actor_id: string
          actor_kind: string
          clinic_id: string
          created_at: string
          file_id: string
          id: string
          previous_id: string | null
          submission_id: string
          user_id: string
          visit_id: string
        }
        SetofOptions: {
          from: "*"
          to: "clinic_result_attachments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _clinic_result_enabled: { Args: never; Returns: boolean }
      _clinic_result_open_visits: { Args: { p_clinic: string }; Returns: Json }
      _clinic_result_retract: {
        Args: {
          a: Database["public"]["Tables"]["clinic_result_attachments"]["Row"]
          p_actor: string
          p_reason: string
          p_sub: string
        }
        Returns: Json
      }
      _clinic_schedule_audit: {
        Args: { a: string; c: string; detail: Json; kind: string }
        Returns: undefined
      }
      _clinic_schedule_command: { Args: { p: Json }; Returns: Json }
      _clinic_schedule_generate: {
        Args: { c: string; p_force: boolean }
        Returns: number
      }
      _clinic_schedule_row: {
        Args: {
          a: Database["public"]["Tables"]["booking_appointments"]["Row"]
          c: string
        }
        Returns: Json
      }
      _clinic_schedule_settings_json: {
        Args: {
          c: string
          m: Database["public"]["Tables"]["clinic_portal_memberships"]["Row"]
        }
        Returns: Json
      }
      _clinic_schedule_tests: {
        Args: { p_arrangement: Json; p_program: string }
        Returns: Json
      }
      _clinic_scheduling_enabled: { Args: never; Returns: boolean }
      _clinic_scheduling_member: {
        Args: { c: string; p_admin: boolean }
        Returns: {
          active: boolean
          clinic_id: string
          display_name: string
          id: string
          revision: number
          role: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "clinic_portal_memberships"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _consultation_arrangement: {
        Args: { p_since: string; p_user: string }
        Returns: {
          actor_id: string
          channel: string
          clinic_id: string | null
          created_at: string
          hold_since: string
          id: string
          scheduled_at: string
          submission_id: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "patient_consultation_arrangements"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _consultation_hold_since: {
        Args: {
          c: Database["public"]["Tables"]["patient_clinical_cases"]["Row"]
        }
        Returns: string
      }
      _conversation_audit: {
        Args: { c: string; d: Json; k: string }
        Returns: undefined
      }
      _conversation_authorize: {
        Args: {
          a: string
          amr: Json
          create_grant: boolean
          m: string
          sid: string
          staff_only: boolean
        }
        Returns: Json
      }
      _conversation_awaiting_before_retry: { Args: never; Returns: Json }
      _conversation_delivery_reason: {
        Args: { p_delivery: string }
        Returns: string
      }
      _conversation_hash: {
        Args: { b: string; c: string; m: string }
        Returns: string
      }
      _conversation_member_thread_before_retry: { Args: never; Returns: Json }
      _conversation_nurse_replies: {
        Args: { p_conversation: string }
        Returns: Json
      }
      _conversation_receipt: {
        Args: { a: Json; c: string; p: Json; r: string; result: Json }
        Returns: Json
      }
      _conversation_record_outcome: {
        Args: { p_attempt: string; p_observed: boolean; p_outcome: Json }
        Returns: Json
      }
      _conversation_replay: {
        Args: { a: Json; c: string; p: Json; r: string }
        Returns: Json
      }
      _conversation_retry_authorize: {
        Args: {
          a: string
          amr: Json
          create_grant: boolean
          m: string
          p_approver: string
          p_clinic: string
          sid: string
          staff_only: boolean
        }
        Returns: Json
      }
      _conversation_retry_block: {
        Args: { p_delivery: string }
        Returns: string
      }
      _conversation_retry_workspace_projection: {
        Args: { p_workspace: Json }
        Returns: Json
      }
      _conversation_source: { Args: { m: string }; Returns: string }
      _conversation_topic_breaks: {
        Args: { p_conversation: string }
        Returns: Json
      }
      _conversation_trace: {
        Args: {
          p_actor: string
          p_actor_kind: string
          p_attributes: Json
          p_conversation: string
          p_member: string
          p_name: string
          p_outcome: string
          p_reason: string
          p_rule: string
          p_rule_version: string
          p_step: string
          p_subject_id: string
          p_subject_kind: string
        }
        Returns: boolean
      }
      _conversation_trace_actor: { Args: never; Returns: string }
      _conversation_trace_code: { Args: { x: string }; Returns: string }
      _conversation_user: {
        Args: { m: string; staff_only: boolean }
        Returns: Json
      }
      _conversation_utf16: { Args: { t: string }; Returns: number }
      _delivery_outcome_valid: { Args: { o: Json }; Returns: boolean }
      _delivery_retain_observation: {
        Args: { p_attempt: string; p_channel: string; p_outcome: Json }
        Returns: Json
      }
      _doctor_completion_enabled: { Args: never; Returns: boolean }
      _doctor_decision_snapshot: {
        Args: { p_id: string; p_kind: string }
        Returns: Json
      }
      _doctor_telegram_close: { Args: { p_id: string }; Returns: undefined }
      _doctor_telegram_service: { Args: never; Returns: undefined }
      _doctor_telegram_valid: {
        Args: {
          c: Database["public"]["Tables"]["doctor_telegram_connections"]["Row"]
        }
        Returns: boolean
      }
      _draft_regimen: { Args: { d: Json }; Returns: Json }
      _evidence_instant: { Args: { t: string }; Returns: string }
      _first_note_backlog_authorize: {
        Args: { p_member: string }
        Returns: undefined
      }
      _first_note_doctor: { Args: { p_user: string }; Returns: string }
      _first_note_enabled: { Args: never; Returns: boolean }
      _first_note_json: {
        Args: { n: Database["public"]["Tables"]["member_first_notes"]["Row"] }
        Returns: Json
      }
      _first_note_notice: {
        Args: {
          p_at: string
          p_member: string
          p_text_en: string
          p_text_hy: string
        }
        Returns: undefined
      }
      _first_note_queue_viewer: { Args: never; Returns: string }
      _fit_regimen_lines: {
        Args: { p_lines: string[]; p_max: number }
        Returns: string
      }
      _freeze_member_sources: {
        Args: { p_member: string; p_sources: string[] }
        Returns: undefined
      }
      _gp_report_assigned_doctor: {
        Args: { p_member: string }
        Returns: undefined
      }
      _gp_report_enabled: { Args: never; Returns: boolean }
      _gp_report_reader: { Args: { p_member: string }; Returns: boolean }
      _gp_report_source_body: { Args: { p_member: string }; Returns: Json }
      _home_visit_is_home: {
        Args: {
          r: Database["public"]["Tables"]["patient_test_requests"]["Row"]
        }
        Returns: boolean
      }
      _home_visit_notify: {
        Args: {
          r: Database["public"]["Tables"]["patient_test_requests"]["Row"]
        }
        Returns: undefined
      }
      _lab_ai_auto_accept_ok: {
        Args: { v: Database["public"]["Tables"]["lab_ai_values"]["Row"] }
        Returns: boolean
      }
      _lab_ai_auto_source_unit:
        | {
            Args: {
              snippet: string
              test_name: string
              unit: string
              units: Json
              value_text: string
            }
            Returns: boolean
          }
        | {
            Args: {
              ref_text: string
              snippet: string
              test_name: string
              unit: string
              units: Json
              value_text: string
            }
            Returns: boolean
          }
      _lab_ai_auto_unit: { Args: { raw: string }; Returns: string }
      _lab_ai_current: { Args: { p_attachment: string }; Returns: boolean }
      _lab_ai_enabled: { Args: never; Returns: boolean }
      _lab_ai_job_json: {
        Args: { j: Database["public"]["Tables"]["lab_ai_jobs"]["Row"] }
        Returns: Json
      }
      _lab_ai_member_upload_daily_limit: { Args: never; Returns: number }
      _lab_ai_member_upload_enabled: { Args: never; Returns: boolean }
      _lab_ai_verified_values: {
        Args: { p_user: string }
        Returns: {
          catalogue_ref: string
          collected_on: string
          reviewed_at: string
          reviewed_by: string
          unit: string
          value: number
          value_id: string
        }[]
      }
      _lab_clinic_bookings: {
        Args: { p_clinic: string }
        Returns: {
          appointment_id: string
          member_id: string
          starts_at: string
        }[]
      }
      _lab_clinic_pick_booking: {
        Args: { p_clinic: string; p_member: string; p_sample: string }
        Returns: Json
      }
      _lab_clinic_visit_for: {
        Args: {
          p_actor: string
          p_actor_name: string
          p_appointment: string
          p_clinic: string
          p_file: Database["public"]["Tables"]["clinic_batch_files"]["Row"]
          p_member: string
        }
        Returns: string
      }
      _ldl_alt_observations: { Args: { p_member: string }; Returns: Json }
      _ldl_clean: { Args: { p: string; p_max: number }; Returns: string }
      _ldl_date: { Args: { k: string; p: Json }; Returns: string }
      _ldl_doctor_lock: { Args: { p_member: string }; Returns: string }
      _ldl_goal_enabled: { Args: never; Returns: boolean }
      _ldl_goal_json: {
        Args: {
          g: Database["public"]["Tables"]["ldl_goals"]["Row"]
          p_doctor: boolean
        }
        Returns: Json
      }
      _ldl_medicine_facts: {
        Args: { p_days: number; p_member: string }
        Returns: Json
      }
      _ldl_observations: {
        Args: { p_doctor: boolean; p_member: string }
        Returns: Json
      }
      _ldl_pilot_excluded: { Args: { p_member: string }; Returns: boolean }
      _ldl_request_refresh: { Args: never; Returns: number }
      _ldl_response_enabled: { Args: never; Returns: boolean }
      _ldl_response_floor: { Args: { p_member: string }; Returns: string }
      _ldl_response_observations: { Args: { p_member: string }; Returns: Json }
      _ldl_retest_eligible: { Args: { p_member: string }; Returns: boolean }
      _ldl_retest_json: {
        Args: {
          p_doctor: boolean
          r: Database["public"]["Tables"]["ldl_retests"]["Row"]
        }
        Returns: Json
      }
      _ldl_retest_open: {
        Args: {
          p_now: string
          r: Database["public"]["Tables"]["ldl_retests"]["Row"]
        }
        Returns: string
      }
      _ldl_retest_requirement: { Args: never; Returns: Json }
      _ldl_today: { Args: never; Returns: string }
      _legacy_command_patient_test_request: {
        Args: {
          p_actor: string
          p_command_id: string
          p_id: string
          p_input: Json
          p_operation: string
          p_revision: number
          p_staff: boolean
          p_user_id: string
        }
        Returns: Json
      }
      _legacy_create_patient_test_request: {
        Args: {
          p_algorithm_version: string
          p_context_token: string
          p_request_id: string
          p_requirements: Json
          p_terms: Json
          p_user_id: string
        }
        Returns: Json
      }
      _legacy_patient_test_request_dto: {
        Args: {
          p_row: Database["public"]["Tables"]["patient_test_requests"]["Row"]
        }
        Returns: Json
      }
      _lipid_planner_enabled: { Args: never; Returns: boolean }
      _lipid_reviewed_labs: { Args: { p_member: string }; Returns: Json }
      _medicine_ask_blocked: { Args: { m: string }; Returns: string }
      _medicine_ask_json: {
        Args: { a: Database["public"]["Tables"]["member_medicine_asks"]["Row"] }
        Returns: Json
      }
      _medicine_ask_medicine: {
        Args: { p_medicine: string; p_source: string }
        Returns: Json
      }
      _medicine_ask_notice_hold: {
        Args: { p_message: string; p_now: string }
        Returns: string
      }
      _medicine_ask_open: {
        Args: {
          m: string
          p_due: string
          p_medicine: string
          p_now: string
          p_source: string
          p_trigger: string
        }
        Returns: string
      }
      _medicine_tick_counts: {
        Args: {
          m: string
          p_medicine: string
          p_since: string
          p_source: string
        }
        Returns: Json
      }
      _member_callback_admin: { Args: never; Returns: boolean }
      _member_callback_member: { Args: never; Returns: string }
      _member_callback_notice: {
        Args: {
          r: Database["public"]["Tables"]["member_callback_requests"]["Row"]
        }
        Returns: number
      }
      _member_clinic_documents: {
        Args: { p_user: string }
        Returns: {
          attached_at: string
          attachment_id: string
          clinic_name: string
          file_id: string
          measured_size: number
          name: string
          object_id: string
          object_key: string
          sha256: string
          uploaded_at: string
        }[]
      }
      _member_document_release: {
        Args: { p_attachment: string; p_file: string; p_user: string }
        Returns: {
          actor_id: string
          attachment_id: string
          created_at: string
          file_id: string
          id: string
          kind: string
          seq: number
          single_member_confirmed: boolean
          submission_id: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "patient_document_release_events"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _member_history_reader: { Args: { p_user: string }; Returns: boolean }
      _member_ldl_read: { Args: { uid: string }; Returns: Json }
      _member_lesson_member: { Args: never; Returns: string }
      _member_lesson_today: { Args: never; Returns: string }
      _member_medicine_add: {
        Args: {
          p_chat: boolean
          p_dose: string
          p_name: string
          p_request_id: string
          p_times: string[]
          uid: string
        }
        Returns: Json
      }
      _member_medicine_ask_answer: {
        Args: { p_ask: string; p_reason: string; uid: string }
        Returns: Json
      }
      _member_medicine_ask_open: {
        Args: { p_ask: string; uid: string }
        Returns: Json
      }
      _member_medicine_asks_read: { Args: { uid: string }; Returns: Json }
      _member_medicine_dose_report: {
        Args: {
          p_due_at: string
          p_expected_revision: number
          p_medicine: string
          p_status: string
          uid: string
        }
        Returns: Json
      }
      _member_medicine_due: {
        Args: { p_day: string; p_time: string }
        Returns: string
      }
      _member_medicine_json: {
        Args: {
          m: Database["public"]["Tables"]["member_medicines"]["Row"]
          p_from: string
        }
        Returns: Json
      }
      _member_medicine_kept: {
        Args: { p_id: string; p_time: string }
        Returns: boolean
      }
      _member_medicine_times_ok: { Args: { t: string[] }; Returns: boolean }
      _member_medicines_read: { Args: { uid: string }; Returns: Json }
      _member_medicines_staff_read_body: {
        Args: { p_days: number; p_member: string }
        Returns: Json
      }
      _member_notice: {
        Args: {
          p_group: string
          p_key: string
          p_member: string
          p_params: Json
          p_path: string
          p_step: string
          p_template: string
        }
        Returns: string
      }
      _member_notice_app_text: {
        Args: { p_member: string; p_params: Json; p_template: string }
        Returns: string
      }
      _member_notice_closed: {
        Args: {
          p_key: string
          p_member: string
          p_params: Json
          p_template: string
        }
        Returns: boolean
      }
      _member_notice_locale: {
        Args: { p_member: string; p_template: string }
        Returns: string
      }
      _member_notice_nurse_name: { Args: { m: string }; Returns: string }
      _member_notice_params_ok: { Args: { p: Json }; Returns: boolean }
      _member_notice_render: {
        Args: { p_body: string; p_params: Json }
        Returns: string
      }
      _member_notice_safe: {
        Args: {
          p_group: string
          p_key: string
          p_member: string
          p_params: Json
          p_path: string
          p_step: string
          p_template: string
        }
        Returns: string
      }
      _member_notice_text: { Args: { v: string }; Returns: string }
      _member_notice_trace: {
        Args: {
          m: string
          p_group: string
          p_key: string
          p_outcome: string
          p_reason: string
          p_template: string
        }
        Returns: undefined
      }
      _member_notice_turned_off: { Args: { m: string }; Returns: boolean }
      _member_notice_visit: {
        Args: { clinic: string; ends: string; m: string; starts: string }
        Returns: Json
      }
      _member_notice_when: {
        Args: { loc: string; p_prefix?: string; ts: string }
        Returns: Json
      }
      _member_plan_medicines: {
        Args: { p_day: string; p_member: string }
        Returns: {
          active: boolean
          dose: string
          effective_at: string | null
          end_date: string | null
          id: string
          instructions: string
          name: string
          plan_id: string
          start_date: string
          times: string[]
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "patient_care_medications"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      _member_push_member: { Args: never; Returns: string }
      _member_quiet_now: {
        Args: { p_local: string; p_member: string }
        Returns: boolean
      }
      _member_reminder_held: {
        Args: { p_member: string; p_template: string }
        Returns: boolean
      }
      _member_reminder_stale: {
        Args: {
          p_key: string
          p_member: string
          p_params: Json
          p_template: string
        }
        Returns: boolean
      }
      _member_safety_active: {
        Args: { k: string; m: string }
        Returns: {
          assessment_id: string | null
          assessment_revision: number | null
          clear_note: string | null
          cleared_at: string | null
          cleared_by: string | null
          cleared_by_role: string | null
          expires_at: string | null
          hidden_on: string | null
          id: string
          kind: string
          member_id: string
          reviewed_at: string | null
          reviewed_by: string | null
          source_field: string
          source_value: string
          started_at: string
        }
        SetofOptions: {
          from: "*"
          to: "member_safety_holds"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _member_safety_card_end: { Args: { started: string }; Returns: string }
      _member_safety_chest_value: { Args: { a: Json }; Returns: string }
      _member_safety_enabled: { Args: never; Returns: boolean }
      _member_safety_open: {
        Args: {
          act: string
          aid: string
          f: string
          k: string
          m: string
          rev: number
          started: string
          v: string
        }
        Returns: string
      }
      _member_safety_staff: { Args: { p_member: string }; Returns: string }
      _member_safety_syncope_value: { Args: { a: Json }; Returns: string }
      _member_source_key: {
        Args: { p_member: string; p_source: string }
        Returns: number
      }
      _member_upload_ai_backfill: { Args: never; Returns: number }
      _member_upload_ai_job_json: {
        Args: { j: Database["public"]["Tables"]["lab_ai_jobs"]["Row"] }
        Returns: Json
      }
      _member_upload_ai_save: {
        Args: { p_answer: string; p_job: string; p_submission: string }
        Returns: Json
      }
      _member_upload_approval_required: { Args: never; Returns: boolean }
      _member_upload_current_approval: {
        Args: { p_job: string }
        Returns: {
          changes: Json
          command_hash: string | null
          created_at: string
          doctor_id: string
          document_id: string
          id: string
          interpretation_edited: boolean
          interpretation_en: string
          interpretation_hy: string
          job_id: string
          member_id: string
          submission_id: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "member_upload_doctor_approvals"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _member_upload_value_member_visible: {
        Args: { p_source: string; p_value: string }
        Returns: boolean
      }
      _multi_medicine_enabled: { Args: never; Returns: boolean }
      _name_tokens: { Args: { p: string }; Returns: string[] }
      _nurse_visit_arrangement: {
        Args: { p_id: string; p_source: string }
        Returns: string
      }
      _nurse_visit_collect_as: {
        Args: {
          p_actor: string
          p_binding: string
          p_command: Json
          p_generation: number
        }
        Returns: Json
      }
      _nurse_visit_complete_as: {
        Args: {
          p_actor: string
          p_binding: string
          p_command: Json
          p_generation: number
        }
        Returns: Json
      }
      _nurse_visit_context: {
        Args: { p_id: string; p_source: string }
        Returns: Json
      }
      _nurse_visit_counts: { Args: { p_items: Json }; Returns: Json }
      _nurse_visit_detail_as: {
        Args: {
          p_actor: string
          p_binding: string
          p_generation: number
          p_id: string
          p_member: string
          p_source: string
        }
        Returns: Json
      }
      _nurse_visit_enabled: { Args: never; Returns: boolean }
      _nurse_visit_events: {
        Args: { p_id: string; p_names: boolean; p_source: string }
        Returns: Json
      }
      _nurse_visit_has_step: {
        Args: { p_id: string; p_source: string; p_step: string }
        Returns: boolean
      }
      _nurse_visit_is_admin: { Args: never; Returns: boolean }
      _nurse_visit_iso: { Args: { t: string }; Returns: string }
      _nurse_visit_items: {
        Args: { p_id: string; p_source: string }
        Returns: Json
      }
      _nurse_visit_items_marked: {
        Args: { p_id: string; p_source: string; p_values?: boolean }
        Returns: Json
      }
      _nurse_visit_list_as: {
        Args: { p_actor: string; p_binding: string; p_generation: number }
        Returns: Json
      }
      _nurse_visit_mark_as: {
        Args: {
          p_actor: string
          p_binding: string
          p_command: Json
          p_generation: number
        }
        Returns: Json
      }
      _nurse_visit_marks_backfill: { Args: never; Returns: undefined }
      _nurse_visit_number: {
        Args: { hi: number; lo: number; v: Json; whole: boolean }
        Returns: boolean
      }
      _nurse_visit_nurse: {
        Args: never
        Returns: {
          active: boolean
          clinic_id: string | null
          created_at: string
          display_name: string
          management_revision: number
          removed_at: string | null
          role: string
          sees_test_members: boolean
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "workspace_staff"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _nurse_visit_nurse_as: {
        Args: { p_actor: string; p_binding: string; p_generation: number }
        Returns: {
          active: boolean
          clinic_id: string | null
          created_at: string
          display_name: string
          management_revision: number
          removed_at: string | null
          role: string
          sees_test_members: boolean
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "workspace_staff"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _nurse_visit_record_step: {
        Args: {
          p_actor: Database["public"]["Tables"]["workspace_staff"]["Row"]
          p_id: string
          p_member: string
          p_source: string
          p_step: string
          p_submission: string
        }
        Returns: string
      }
      _nurse_visit_row: {
        Args: { p_id: string; p_source: string }
        Returns: Json
      }
      _nurse_visit_step_as: {
        Args: {
          p_actor: string
          p_binding: string
          p_command: Json
          p_generation: number
        }
        Returns: Json
      }
      _nurse_visit_sync_lab: {
        Args: { p_at: string; p_member: string; p_visit: string }
        Returns: undefined
      }
      _nurse_visit_sync_lab_as: {
        Args: {
          p_actor: string
          p_at: string
          p_binding: string
          p_generation: number
          p_member: string
          p_visit: string
        }
        Returns: undefined
      }
      _nurse_visit_tests: {
        Args: { p_id: string; p_source: string }
        Returns: Json
      }
      _patient_coordination_access_as: {
        Args: {
          p_actor: string
          p_binding: string
          p_case: string
          p_generation: number
        }
        Returns: boolean
      }
      _patient_coordination_command_as: {
        Args: {
          p_actor: string
          p_binding: string
          p_case: string
          p_expected_revision: number
          p_generation: number
          p_input: Json
          p_operation: string
          p_request: string
          p_task: string
        }
        Returns: Json
      }
      _patient_coordination_command_before_nurse_handoffs_as: {
        Args: {
          p_actor: string
          p_binding: string
          p_case: string
          p_expected_revision: number
          p_generation: number
          p_input: Json
          p_operation: string
          p_request: string
          p_task: string
        }
        Returns: Json
      }
      _patient_coordination_owner_valid: {
        Args: { p_case: string; p_owner: string; p_referral: boolean }
        Returns: boolean
      }
      _patient_coordination_queue_as: {
        Args: {
          p_actor: string
          p_after_created_at?: string
          p_after_id?: string
          p_binding: string
          p_case?: string
          p_filter?: string
          p_generation: number
          p_limit?: number
        }
        Returns: Json
      }
      _patient_coordination_snapshot_as: {
        Args: {
          p_actor: string
          p_binding: string
          p_generation: number
          p_task: string
        }
        Returns: Json
      }
      _patient_coordination_snapshot_unlogged_as: {
        Args: {
          p_actor: string
          p_binding: string
          p_generation: number
          p_task: string
        }
        Returns: Json
      }
      _patient_coordination_task_json: {
        Args: {
          t: Database["public"]["Tables"]["patient_coordination_tasks"]["Row"]
        }
        Returns: Json
      }
      _patient_current_published_clinical_review: {
        Args: { uid: string }
        Returns: Json
      }
      _patient_lab_active_result: {
        Args: { p_entry: string }
        Returns: {
          actor_id: string | null
          actor_name: string
          actor_role: string
          attachment_id: string | null
          clinic_id: string
          collection_entry_id: string
          id: string
          occurred_at: string
          recorded_at: string
          retracts: string | null
          stage: string
          submission_id: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "patient_care_lab_stages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _patient_lab_current_collection: {
        Args: {
          p_entry: Database["public"]["Tables"]["patient_care_visit_entries"]["Row"]
        }
        Returns: boolean
      }
      _patient_lab_samples: {
        Args: { p_member: string; p_staff: boolean }
        Returns: Json
      }
      _patient_staff_lab_stage_command_as: {
        Args: {
          p_actor: string
          p_binding: string
          p_command: Json
          p_generation: number
        }
        Returns: Json
      }
      _patient_staff_visit_command_as: {
        Args: {
          p_actor: string
          p_binding: string
          p_command: Json
          p_generation: number
        }
        Returns: Json
      }
      _patient_visit_authorize: {
        Args: { p_exclusive: boolean; p_member: string; p_write: boolean }
        Returns: {
          active: boolean
          clinic_id: string | null
          created_at: string
          display_name: string
          management_revision: number
          removed_at: string | null
          role: string
          sees_test_members: boolean
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "workspace_staff"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _patient_visit_authorize_as: {
        Args: {
          p_actor: string
          p_binding: string
          p_exclusive: boolean
          p_generation: number
          p_member: string
          p_write: boolean
        }
        Returns: {
          active: boolean
          clinic_id: string | null
          created_at: string
          display_name: string
          management_revision: number
          removed_at: string | null
          role: string
          sees_test_members: boolean
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "workspace_staff"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _patient_visit_booking: {
        Args: { p_appointment?: string; p_member: string }
        Returns: Json
      }
      _patient_visit_command: { Args: { p: Json }; Returns: Json }
      _patient_visit_history: { Args: { p_member: string }; Returns: Json }
      _patient_visit_instant: { Args: { p: string }; Returns: string }
      _patient_visit_workspace: { Args: { p_member: string }; Returns: Json }
      _pilot_admin: {
        Args: never
        Returns: {
          active: boolean
          clinic_id: string | null
          created_at: string
          display_name: string
          management_revision: number
          removed_at: string | null
          role: string
          sees_test_members: boolean
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "workspace_staff"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _pilot_booking_items: {
        Args: { p_appointment: string; p_request: string }
        Returns: Record<string, unknown>
      }
      _pilot_catalog_test_json: {
        Args: {
          p_now: string
          t: Database["public"]["Tables"]["pilot_catalog_tests"]["Row"]
        }
        Returns: Json
      }
      _pilot_current_price: {
        Args: { p_at: string; p_test: string }
        Returns: {
          effective_from: string
          id: string
          price_amd: number
          price_source: string
          reason: string
          recorded_at: string
          recorded_by: string | null
          recorded_by_name: string
          test_id: string
        }
        SetofOptions: {
          from: "*"
          to: "pilot_catalog_prices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _pilot_payment_json: {
        Args: {
          p_admin: boolean
          y: Database["public"]["Tables"]["pilot_payments"]["Row"]
        }
        Returns: Json
      }
      _pilot_payment_transition_allowed: {
        Args: { p_from: string; p_to: string }
        Returns: boolean
      }
      _pilot_price_items: {
        Args: { p_items: Json }
        Returns: Record<string, unknown>
      }
      _pilot_price_json: {
        Args: { p: Database["public"]["Tables"]["pilot_catalog_prices"]["Row"] }
        Returns: Json
      }
      _pilot_today: { Args: never; Returns: string }
      _plan_regimen_versions: { Args: { p_user: string }; Returns: Json }
      _programme_anchor: {
        Args: { p_member: string }
        Returns: Record<string, unknown>
      }
      _programme_doctor: { Args: { p_member: string }; Returns: string }
      _programme_due_on: {
        Args: { p_anchor: string; p_kind: string }
        Returns: string
      }
      _programme_enabled: { Args: never; Returns: boolean }
      _programme_member: { Args: never; Returns: string }
      _programme_note_notice: {
        Args: { p_checkpoint: string; p_member: string; p_note: string }
        Returns: undefined
      }
      _programme_schedule: { Args: { p_member: string }; Returns: number }
      _programme_today: { Args: { p_now: string }; Returns: string }
      _rate_limit_policy: {
        Args: { p_kind: string; p_operation: string }
        Returns: Record<string, unknown>
      }
      _real_admin_save_scheduling_email: {
        Args: {
          p_clinic_id: string
          p_email: string
          p_expected_revision: number
          p_operation: string
          p_request_id: string
        }
        Returns: Json
      }
      _real_scheduling_email: { Args: { p_email: string }; Returns: string }
      _real_staff_amr_allowed: { Args: { p_amr: Json }; Returns: boolean }
      _real_staff_directory_row: { Args: { p_staff_id: string }; Returns: Json }
      _real_staff_dispatch_invitation: {
        Args: { p_generation: number; p_id: string; p_operation_id: string }
        Returns: {
          accepted_at: string | null
          accepted_session_id: string | null
          auth_user_id: string | null
          clinic_id: string
          created_at: string
          delivery: string
          dispatch_claimed_at: string | null
          display_name: string
          email: string
          expected_auth_user_id: string
          expires_at: string
          generation: number
          id: string
          invited_phone: string | null
          issuer_id: string
          last_requested_at: string
          management_revision: number
          operation_id: string
          provider_reference: string | null
          role: string
          send_status: string
          status: string
          token_digest: string | null
          token_type: string | null
          verified_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "real_staff_invitations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _real_staff_invitation_json: {
        Args: {
          i: Database["public"]["Tables"]["real_staff_invitations"]["Row"]
        }
        Returns: Json
      }
      _real_staff_lock_invitation: {
        Args: { p_allow_accepted?: boolean; p_generation: number; p_id: string }
        Returns: {
          accepted_at: string | null
          accepted_session_id: string | null
          auth_user_id: string | null
          clinic_id: string
          created_at: string
          delivery: string
          dispatch_claimed_at: string | null
          display_name: string
          email: string
          expected_auth_user_id: string
          expires_at: string
          generation: number
          id: string
          invited_phone: string | null
          issuer_id: string
          last_requested_at: string
          management_revision: number
          operation_id: string
          provider_reference: string | null
          role: string
          send_status: string
          status: string
          token_digest: string | null
          token_type: string | null
          verified_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "real_staff_invitations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _real_staff_manage: {
        Args: {
          p_clinic_id: string
          p_display_name: string
          p_expected_version: string
          p_operation: string
          p_request_id: string
          p_staff_id: string
        }
        Returns: Json
      }
      _real_staff_managed_session_allowed: {
        Args: { p_actor: string }
        Returns: boolean
      }
      _real_staff_recovery_identity: {
        Args: { p_session?: string; p_staff: string }
        Returns: Json
      }
      _real_staff_recovery_json: {
        Args: {
          r: Database["public"]["Tables"]["real_staff_recoveries"]["Row"]
        }
        Returns: Json
      }
      _real_staff_require_admin: { Args: never; Returns: string }
      _record_patient_measurement: {
        Args: {
          p_diastolic: number
          p_measured_at: string
          p_pulse: number
          p_submission_id: string
          p_systolic: number
          uid: string
        }
        Returns: string
      }
      _record_patient_measurement_sourced: {
        Args: {
          p_diastolic: number
          p_entry_source: string
          p_measured_at: string
          p_pulse: number
          p_submission_id: string
          p_systolic: number
          uid: string
        }
        Returns: string
      }
      _regimen_approval_hash: {
        Args: { p_prior: string; p_regimen: Json }
        Returns: string
      }
      _regimen_changes: { Args: { p_next: Json; p_prev: Json }; Returns: Json }
      _regimen_name_key: { Args: { p: string }; Returns: string }
      _report_patient_dose_unversioned: {
        Args: {
          p_due_at: string
          p_medication_id: string
          p_status: string
          uid: string
        }
        Returns: undefined
      }
      _report_patient_dose_versioned: {
        Args: {
          p_due_at: string
          p_expected_revision: number
          p_medication_id: string
          p_status: string
          uid: string
        }
        Returns: number
      }
      _report_pdf_artifact_valid: {
        Args: {
          p_artifact: Json
          p_checksum: string
          p_mime: string
          p_pages: number
          p_size: number
        }
        Returns: boolean
      }
      _report_required_lab_values: {
        Args: { p_receipt: Json; p_user: string }
        Returns: Json
      }
      _required_evidence_kind: { Args: { p_test: string }; Returns: string }
      _required_evidence_source: {
        Args: { p_source: string; p_test: string; p_user: string }
        Returns: Json
      }
      _required_evidence_sources: {
        Args: { p_test: string; p_user: string }
        Returns: Json[]
      }
      _required_lab_analyte: { Args: { p_name: string }; Returns: string }
      _required_lab_mapping: { Args: never; Returns: Json }
      _required_lab_test_covered: {
        Args: { p_test: string; p_values: Json }
        Returns: boolean
      }
      _required_lab_values: {
        Args: { p_test: string; p_values: Json }
        Returns: Json
      }
      _sample_collected_notice: {
        Args: {
          p_arrangement: string
          p_id: string
          p_items: Json
          p_member: string
          p_source: string
        }
        Returns: undefined
      }
      _sample_collected_test_title: {
        Args: { p_id: string; p_locale: string; p_title: string }
        Returns: string
      }
      _side_effect_nurse_task: {
        Args: { p_member: string; p_request_id: string; p_what: string }
        Returns: Json
      }
      _staff_account_exists: { Args: { u: string }; Returns: boolean }
      _staff_invite_binding: {
        Args: {
          i: Database["public"]["Tables"]["real_staff_invitations"]["Row"]
        }
        Returns: {
          account_ref: string
          active: boolean
          address: string
          auth_user_id: string
          created_at: string
          generation: number
          id: string
          kind: string
          pending_clinic_invitation_id: string | null
          pending_invitation_id: string | null
          phone: string
          principal_ref: string
          proven_at: string
          proven_by: string | null
          revoked_at: string | null
          revoked_reason: string | null
        }
        SetofOptions: {
          from: "real_staff_invitations"
          to: "telegram_auth_bindings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _staff_lab_ai_results_body: { Args: { p_user_id: string }; Returns: Json }
      _staff_message_notice: {
        Args: {
          a: Database["public"]["Tables"]["conversation_doctor_alerts"]["Row"]
        }
        Returns: undefined
      }
      _staff_message_notice_trace: {
        Args: {
          a: Database["public"]["Tables"]["conversation_doctor_alerts"]["Row"]
          p_attrs: Json
          p_name: string
          p_outcome: string
          p_reason: string
        }
        Returns: undefined
      }
      _staff_recovery_open: {
        Args: { p_id: string }
        Returns: {
          auth_user_id: string
          binding_generation: number
          binding_id: string
          completed_at: string | null
          created_at: string
          expires_at: string
          id: string
          issuer_id: string
          portal: string
          status: string
          token_hash: string | null
          verified_at: string | null
          verified_nonce_hmac: string | null
        }
        SetofOptions: {
          from: "*"
          to: "staff_telegram_recoveries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _staff_session_admitted: {
        Args: { a: string; s: string }
        Returns: boolean
      }
      _staff_signin_eligible: { Args: { u: string }; Returns: boolean }
      _staff_signin_required: { Args: never; Returns: boolean }
      _staff_zoe_assigned: {
        Args: { p_member: string }
        Returns: {
          active: boolean
          clinic_id: string | null
          created_at: string
          display_name: string
          management_revision: number
          removed_at: string | null
          role: string
          sees_test_members: boolean
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "workspace_staff"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _staff_zoe_on: { Args: never; Returns: boolean }
      _staff_zoe_staff: {
        Args: never
        Returns: {
          active: boolean
          clinic_id: string | null
          created_at: string
          display_name: string
          management_revision: number
          removed_at: string | null
          role: string
          sees_test_members: boolean
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "workspace_staff"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _staff_zoe_tool_allowed: {
        Args: { p_role: string; p_tool: string }
        Returns: boolean
      }
      _system_message_audit: {
        Args: { d: Json; k: string; m: string }
        Returns: undefined
      }
      _system_message_enqueue: {
        Args: {
          ep: Database["public"]["Tables"]["conversation_endpoints"]["Row"]
          m: string
          p_inbox: string
          p_template: string
        }
        Returns: string
      }
      _system_message_hash: {
        Args: { b: string; l: string; t: string; v: number }
        Returns: string
      }
      _system_message_record_outcome: {
        Args: { p_attempt: string; p_observed: boolean; p_outcome: Json }
        Returns: Json
      }
      _telegram_account_ref: {
        Args: {
          s: Database["public"]["Tables"]["telegram_channel_settings"]["Row"]
        }
        Returns: string
      }
      _telegram_audit: {
        Args: { d: Json; k: string; m: string }
        Returns: undefined
      }
      _telegram_auth_audit: {
        Args: { d: Json; k: string; u: string }
        Returns: undefined
      }
      _telegram_auth_bind: {
        Args: {
          p_account: string
          p_address: string
          p_allow_replace?: boolean
          p_kind: string
          p_phone: string
          p_principal: string
          p_proven_by: string
          p_user: string
        }
        Returns: Json
      }
      _telegram_auth_contact: {
        Args: { r: Database["public"]["Tables"]["channel_inbox"]["Row"] }
        Returns: Json
      }
      _telegram_auth_enqueue: {
        Args: {
          p_address: string
          p_inbox: string
          p_keyboard: Json
          p_locale: string
          p_principal: string
          p_template: string
        }
        Returns: string
      }
      _telegram_auth_locale: { Args: { u: string }; Returns: string }
      _telegram_auth_message_claim_base: {
        Args: { p_attempt: string; p_message: string }
        Returns: Json
      }
      _telegram_auth_message_claim_core: {
        Args: { p_attempt: string; p_message: string }
        Returns: Json
      }
      _telegram_auth_start: {
        Args: { r: Database["public"]["Tables"]["channel_inbox"]["Row"] }
        Returns: Json
      }
      _telegram_bot_next_step: {
        Args: { r: Database["public"]["Tables"]["channel_inbox"]["Row"] }
        Returns: Json
      }
      _telegram_delivery_problems_before_retry: { Args: never; Returns: Json }
      _telegram_hold_member_deliveries: {
        Args: { m: string; p_reason: string }
        Returns: undefined
      }
      _telegram_member_eligible: { Args: { m: string }; Returns: boolean }
      _telegram_notice_bound: { Args: { p_template: string }; Returns: boolean }
      _telegram_nurse_authority: {
        Args: { p_binding: string; p_generation: number }
        Returns: {
          active: boolean
          clinic_id: string | null
          created_at: string
          display_name: string
          management_revision: number
          removed_at: string | null
          role: string
          sees_test_members: boolean
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "workspace_staff"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _telegram_nurse_case_access: {
        Args: {
          p_actor: string
          p_binding: string
          p_case: string
          p_generation: number
        }
        Returns: boolean
      }
      _telegram_nurse_enqueue: {
        Args: {
          p_members?: string[]
          p_question: number
          p_turn: Json
          r: Database["public"]["Tables"]["channel_inbox"]["Row"]
        }
        Returns: string
      }
      _telegram_nurse_inbox_authority: {
        Args: { r: Database["public"]["Tables"]["channel_inbox"]["Row"] }
        Returns: {
          active: boolean
          clinic_id: string | null
          created_at: string
          display_name: string
          management_revision: number
          removed_at: string | null
          role: string
          sees_test_members: boolean
          user_id: string
        }
        SetofOptions: {
          from: "channel_inbox"
          to: "workspace_staff"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _telegram_nurse_intent_arm: {
        Args: { p_outbox: string; p_revision: number; p_task: string }
        Returns: string
      }
      _telegram_nurse_on: { Args: { p_enabled: boolean }; Returns: boolean }
      _telegram_nurse_slot: {
        Args: { p_limit: number; p_line?: boolean; p_text: string }
        Returns: string
      }
      _telegram_nurse_task_apply: {
        Args: { p_attempt: number; p_enabled: boolean; p_id: string }
        Returns: Json
      }
      _telegram_nurse_task_cleanup_run: { Args: never; Returns: Json }
      _telegram_nurse_task_receive: {
        Args: { p_enabled: boolean; p_id: string }
        Returns: Json
      }
      _telegram_nurse_task_template_schema: {
        Args: { p_kind: string }
        Returns: Json
      }
      _telegram_nurse_template_schema: {
        Args: { p_kind: string }
        Returns: Json
      }
      _telegram_nurse_visit_arm: {
        Args: {
          p_action: string
          p_id: string
          p_key: string
          p_member: string
          p_outbox: string
          p_source: string
          p_token: string
        }
        Returns: string
      }
      _telegram_nurse_visit_clear: {
        Args: { p_binding: string; p_generation: number }
        Returns: undefined
      }
      _telegram_nurse_visit_detail: {
        Args: {
          m: string
          r: Database["public"]["Tables"]["channel_inbox"]["Row"]
          s: Database["public"]["Tables"]["workspace_staff"]["Row"]
          sid: string
          src: string
        }
        Returns: Json
      }
      _telegram_nurse_visit_flow_valid: {
        Args: { p_flow: Json; p_snapshot: Json }
        Returns: boolean
      }
      _telegram_nurse_visit_key: {
        Args: { p_key: string; p_snapshot: Json }
        Returns: boolean
      }
      _telegram_nurse_visit_pending: {
        Args: {
          p_member: string
          p_operation: string
          p_question: number
          r: Database["public"]["Tables"]["channel_inbox"]["Row"]
        }
        Returns: Json
      }
      _telegram_nurse_visit_retire: {
        Args: {
          p_status: string
          r: Database["public"]["Tables"]["channel_inbox"]["Row"]
        }
        Returns: undefined
      }
      _telegram_nurse_visit_safe: { Args: { p_snapshot: Json }; Returns: Json }
      _telegram_nurse_visit_token: {
        Args: { p_snapshot: Json }
        Returns: string
      }
      _telegram_nurse_visit_work: {
        Args: {
          p_phase: string
          r: Database["public"]["Tables"]["channel_inbox"]["Row"]
        }
        Returns: Json
      }
      _telegram_principal_ref: {
        Args: {
          s: Database["public"]["Tables"]["telegram_channel_settings"]["Row"]
          user_id: number
        }
        Returns: string
      }
      _telegram_replies_activate: {
        Args: { m: string; p_binding: string }
        Returns: Json
      }
      _telegram_replies_auto: {
        Args: { m: string; p_explicit: boolean }
        Returns: Json
      }
      _telegram_replies_notice: {
        Args: {
          ep: Database["public"]["Tables"]["conversation_endpoints"]["Row"]
          m: string
        }
        Returns: undefined
      }
      _telegram_revoke_binding: {
        Args: { p_binding: string; p_reason: string }
        Returns: Json
      }
      _telegram_revoke_binding_core: {
        Args: { p_binding: string; p_reason: string }
        Returns: Json
      }
      _telegram_signin_links_cancel: {
        Args: { p_reason: string; p_user: string }
        Returns: number
      }
      _test_account_audit: {
        Args: {
          a: string
          d: Json
          m: string
          r: string
          s: Database["public"]["Tables"]["workspace_staff"]["Row"]
        }
        Returns: undefined
      }
      _test_account_is_staff: { Args: { u: string }; Returns: boolean }
      _test_account_operator: {
        Args: never
        Returns: {
          active: boolean
          clinic_id: string | null
          created_at: string
          display_name: string
          management_revision: number
          removed_at: string | null
          role: string
          sees_test_members: boolean
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "workspace_staff"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _test_account_reset_busy: { Args: { m: string }; Returns: boolean }
      _test_member_hidden: {
        Args: { p_member: string; p_staff: string }
        Returns: boolean
      }
      _test_signin_allowed: {
        Args: { p_env_enabled: boolean; p_phone: string }
        Returns: boolean
      }
      _test_signin_audit: {
        Args: {
          p_action: string
          p_actor: string
          p_outcome: string
          p_phone: string
        }
        Returns: undefined
      }
      _test_signin_hash_equal: {
        Args: { a: string; b: string }
        Returns: boolean
      }
      _typed_bp_task: {
        Args: { m: Database["public"]["Tables"]["patient_measurements"]["Row"] }
        Returns: undefined
      }
      _workspace_report_pdf_artifact_valid: {
        Args: { p_record: Json }
        Returns: boolean
      }
      _zoe_ack_release: {
        Args: { p_message: string; p_reason: string }
        Returns: undefined
      }
      _zoe_active_for: { Args: { m: string }; Returns: boolean }
      _zoe_answer_enqueue: {
        Args: { m: string; p_body: string; p_inbox: string }
        Returns: string
      }
      _zoe_answered_open: { Args: { p_conversation: string }; Returns: Json }
      _zoe_bp_merge_failed: {
        Args: { p_member: string; p_ref: string; p_state: string }
        Returns: undefined
      }
      _zoe_bp_reconcile: { Args: { p_item: string }; Returns: undefined }
      _zoe_chat_actions_on: { Args: never; Returns: boolean }
      _zoe_chat_card_for_template: { Args: { t: string }; Returns: string }
      _zoe_chat_card_json: {
        Args: { k: Database["public"]["Tables"]["zoe_chat_cards"]["Row"] }
        Returns: Json
      }
      _zoe_chat_message_cleared: {
        Args: { m: string; p_seq: number }
        Returns: boolean
      }
      _zoe_chat_reading_cleared: {
        Args: { m: string; p_seq: number }
        Returns: boolean
      }
      _zoe_coach_block_reason: {
        Args: { m: string; p_purpose?: string; p_spend?: boolean }
        Returns: string
      }
      _zoe_coach_cancel_member: {
        Args: { m: string; p_reason: string }
        Returns: number
      }
      _zoe_coach_check: {
        Args: {
          ev: Database["public"]["Tables"]["coach_events"]["Row"]
          p_stage: string
        }
        Returns: Record<string, unknown>
      }
      _zoe_coach_consent_current: {
        Args: { m: string; p_kind: string }
        Returns: boolean
      }
      _zoe_coach_iso_week: { Args: { p_at: string }; Returns: string }
      _zoe_coach_lock: { Args: { m: string }; Returns: undefined }
      _zoe_coach_move: {
        Args: {
          p_event: string
          p_reason: string
          p_retry: string
          p_state: string
        }
        Returns: {
          attempts: number
          cancelled_at: string | null
          claimed_at: string | null
          claimed_member_seq: number | null
          conversation_id: string | null
          created_at: string
          due_at: string
          event_key: string
          id: string
          iso_week: string
          kind: string
          member_id: string
          ready_at: string | null
          reason: string | null
          retry_at: string | null
          run_id: string | null
          sent_at: string | null
          state: string
          state_seq: number
          telegram_message_id: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "coach_events"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _zoe_coach_next_send: {
        Args: { m: string; p_from: string }
        Returns: string
      }
      _zoe_coach_quiet: { Args: { m: string; p_at: string }; Returns: boolean }
      _zoe_coach_retryable: { Args: { p_reason: string }; Returns: boolean }
      _zoe_coach_tz: { Args: never; Returns: string }
      _zoe_coach_week_end: { Args: { due: string }; Returns: string }
      _zoe_consent_current: {
        Args: { m: string; p_kind: string }
        Returns: boolean
      }
      _zoe_consent_ok: { Args: { m: string }; Returns: boolean }
      _zoe_consent_view: { Args: { m: string }; Returns: Json }
      _zoe_doctor_mode: { Args: { p_conversation: string }; Returns: boolean }
      _zoe_injection_alert: {
        Args: { r: Database["public"]["Tables"]["zoe_runs"]["Row"] }
        Returns: undefined
      }
      _zoe_intake_notice: { Args: { p_intake: string }; Returns: undefined }
      _zoe_member_eligible: { Args: { m: string }; Returns: boolean }
      _zoe_mode_doctor: { Args: { p_member: string }; Returns: string }
      _zoe_mode_notify: {
        Args: {
          m: string
          p_at: string
          p_conversation: string
          p_kind: string
        }
        Returns: string
      }
      _zoe_plan_medicines: { Args: { d: Json }; Returns: Json }
      _zoe_real_calls_permitted: { Args: { p_model: string }; Returns: boolean }
      _zoe_replies_on: { Args: { m: string }; Returns: boolean }
      _zoe_run_events: {
        Args: {
          p_events: Json
          r: Database["public"]["Tables"]["zoe_runs"]["Row"]
        }
        Returns: number
      }
      _zoe_run_finish_core: {
        Args: { p_result: Json; p_run: string }
        Returns: Json
      }
      _zoe_self_harm_today_minutes: {
        Args: { p_conversation: string }
        Returns: number
      }
      _zoe_symptom_intakes_for_doctor_body: {
        Args: { p_member: string }
        Returns: Json
      }
      _zoe_takeover_scope: { Args: never; Returns: string }
      _zoe_talking_urgent_window: {
        Args: { p_conversation: string }
        Returns: {
          opened_by: string
          started_at: string
        }[]
      }
      _zoe_template_ok: {
        Args: { p_locale: string; p_template: string }
        Returns: boolean
      }
      _zoe_text_enqueue: {
        Args: {
          m: string
          p_body0: string
          p_inbox: string
          p_template: string
        }
        Returns: string
      }
      _zoe_text_hold: { Args: { p_message: string }; Returns: string }
      _zoe_text_hold_queued: {
        Args: {
          p_conversation: string
          p_reason: string
          p_through_seq: number
        }
        Returns: number
      }
      _zoe_tier_floor: { Args: { t: string }; Returns: number }
      _zoe_tier_json: {
        Args: { c: Database["public"]["Tables"]["zoe_tier_config"]["Row"] }
        Returns: Json
      }
      _zoe_tier_rank: { Args: { t: string }; Returns: number }
      _zoe_urgent_alert: {
        Args: {
          p_flags: string[]
          p_member: string
          p_reason: string
          p_run: string
          p_version: string
        }
        Returns: Json
      }
      _zoe_urgent_window: {
        Args: { p_conversation: string }
        Returns: {
          opened_by: string
          started_at: string
        }[]
      }
      _zoe_v3_lab_snapshot: {
        Args: { a: Database["public"]["Tables"]["booking_appointments"]["Row"] }
        Returns: Json
      }
      _zoe_wording_current: {
        Args: {
          s: Database["public"]["Tables"]["zoe_settings"]["Row"]
          v: string
        }
        Returns: boolean
      }
      acknowledge_patient_message_attention: {
        Args: {
          p_attempt_id: string
          p_expected_evidence: string
          p_operator_label: string
        }
        Returns: boolean
      }
      acknowledge_patient_plan: {
        Args: { p_plan_id: string }
        Returns: undefined
      }
      admin_audit_log: {
        Args: {
          p_actor?: string
          p_category?: string
          p_cursor?: string
          p_from?: string
          p_limit?: number
          p_member?: string
          p_profile_values?: boolean
          p_to?: string
        }
        Returns: Json
      }
      admin_audit_log_export: {
        Args: {
          p_actor?: string
          p_category?: string
          p_from?: string
          p_member?: string
          p_profile_values?: boolean
          p_to?: string
        }
        Returns: Json
      }
      admin_audit_people: { Args: never; Returns: Json }
      admin_consultation_arrange_command: {
        Args: { p_command: Json }
        Returns: Json
      }
      admin_consultations_to_arrange: { Args: never; Returns: Json }
      admin_conversation_list: { Args: { p_filter?: string }; Returns: Json }
      admin_conversation_read: {
        Args: { p_before?: string; p_member: string }
        Returns: Json
      }
      admin_conversation_read_enabled: { Args: never; Returns: boolean }
      admin_lab_upload_overrides: {
        Args: {
          p_clinic?: string
          p_from?: string
          p_mismatch?: string
          p_to?: string
        }
        Returns: Json
      }
      admin_ldl_retest_ack: {
        Args: { p_note: string; p_retest: string }
        Returns: Json
      }
      admin_ldl_retests: { Args: never; Returns: Json }
      admin_member_contacts: { Args: { p_members: string[] }; Returns: Json }
      admin_member_contacts_unlogged: {
        Args: { p_members: string[] }
        Returns: Json
      }
      admin_member_registrations: {
        Args: { p_limit?: number; p_step?: number; p_stuck_days?: number }
        Returns: Json
      }
      admin_set_test_account: {
        Args: { p_member: string; p_reason: string; p_test: boolean }
        Returns: Json
      }
      ai_plan_finish: {
        Args: { p_generation: string; p_result: Json }
        Returns: Json
      }
      ai_plan_reserve: {
        Args: {
          p_builder_version: string
          p_doctor: string
          p_estimate_usd: number
          p_input_sha256: string
          p_lab_token: string
          p_language: string
          p_local: boolean
          p_model: string
          p_prompt_version: string
          p_revision: number
          p_tier: string
          p_token: string
          p_user: string
        }
        Returns: Json
      }
      apply_booking_notice_receipt: {
        Args: {
          p_attempt: string
          p_engine: string
          p_notice: string
          p_sender: string
          p_template: string
        }
        Returns: Json
      }
      assign_case_nurse: {
        Args: {
          p_actor: string
          p_id: string
          p_native?: boolean
          p_nurse?: string
          p_revision: number
        }
        Returns: number
      }
      assign_patient_case_nurse: {
        Args: { p_id: string; p_nurse?: string; p_revision: number }
        Returns: number
      }
      assign_patient_clinical_case: {
        Args: {
          p_doctor_id?: string
          p_expected_revision: number
          p_user_id: string
        }
        Returns: number
      }
      auth_cleanup_run: { Args: never; Returns: Json }
      auth_code_request_abandon: {
        Args: { p_nonce_hmac: string; p_request: string }
        Returns: Json
      }
      auth_code_request_allow_proof: {
        Args: { p_nonce_hmac: string; p_request: string }
        Returns: Json
      }
      auth_code_request_begin: {
        Args: { p_nonce_hmac: string; p_phone: string }
        Returns: Json
      }
      auth_code_request_check: {
        Args: { p_code_digest: string; p_nonce_hmac: string; p_request: string }
        Returns: Json
      }
      auth_code_request_claim: {
        Args: { p_body_hmac: string; p_phone: string; p_webhook_id: string }
        Returns: Json
      }
      auth_code_request_finish: {
        Args: {
          p_code_digest?: string
          p_outcome: string
          p_request: string
          p_webhook_id: string
        }
        Returns: Json
      }
      auth_code_request_link_open: {
        Args: { p_nonce_hmac: string; p_phone: string; p_token_hash: string }
        Returns: Json
      }
      auth_code_request_proof_state: {
        Args: { p_nonce_hmac: string; p_phone: string }
        Returns: Json
      }
      auth_code_request_seal: {
        Args: { p_request: string; p_sealed: string; p_webhook_id: string }
        Returns: Json
      }
      auth_code_request_status: {
        Args: { p_nonce_hmac: string; p_request: string }
        Returns: Json
      }
      auth_code_request_verified: {
        Args: {
          p_code_digest: string
          p_nonce_hmac: string
          p_request: string
          p_session: string
          p_user: string
        }
        Returns: Json
      }
      begin_patient_message_submission: {
        Args: { p_job_id: string }
        Returns: {
          attempt_id: string
          channel: string
          destination: string
          locale: string
          template_key: string
        }[]
      }
      begin_patient_message_submission_budgeted: {
        Args: {
          p_available_channels?: string[]
          p_job_id: string
          p_policy_revision: number
        }
        Returns: {
          attempt_id: string
          channel: string
          destination: string
          locale: string
          template_key: string
        }[]
      }
      begin_patient_message_submission_budgeted_before_channel_gate: {
        Args: { p_job_id: string; p_policy_revision: number }
        Returns: {
          attempt_id: string
          channel: string
          destination: string
          locale: string
          template_key: string
        }[]
      }
      begin_patient_message_submission_uncontrolled: {
        Args: { p_job_id: string }
        Returns: {
          attempt_id: string
          channel: string
          destination: string
          locale: string
          template_key: string
        }[]
      }
      booking_pilot_offers: {
        Args: { p_actor: string; p_member: string; p_program_id: string }
        Returns: Json
      }
      booking_pilot_programme_state: {
        Args: { p_member?: string }
        Returns: Json
      }
      booking_pilot_workspace: { Args: { p_member?: string }; Returns: Json }
      booking_pilot_workspace_details: {
        Args: { p_member?: string }
        Returns: Json
      }
      booking_pilot_workspace_details_unlogged: {
        Args: { p_member?: string }
        Returns: Json
      }
      booking_pilot_workspace_unlogged: {
        Args: { p_member?: string }
        Returns: Json
      }
      booking_portal_cancel: {
        Args: {
          p_actor: string
          p_agreement_source?: string
          p_appointment: string
          p_command: string
          p_member: string
          p_revision: number
        }
        Returns: Json
      }
      booking_portal_details: { Args: { p_member?: string }; Returns: Json }
      booking_portal_proposal_answer: {
        Args: {
          p_accept: boolean
          p_actor: string
          p_command: string
          p_member: string
          p_proposal: string
        }
        Returns: Json
      }
      booking_program_source: {
        Args: { p_actor: string; p_member: string }
        Returns: Json
      }
      bp_admin_device_inventory: { Args: never; Returns: Json }
      bp_check_retry: { Args: { p_limit: number }; Returns: Json }
      bp_device_command: { Args: { p_command: Json }; Returns: Json }
      bp_device_ingest_reading: { Args: { p_reading: Json }; Returns: Json }
      bp_photo_member_allowed: { Args: { p_member: string }; Returns: boolean }
      bp_staff_member_devices: { Args: { p_member: string }; Returns: Json }
      bp_staff_member_devices_unlogged: {
        Args: { p_member: string }
        Returns: Json
      }
      bp_week_member_read: { Args: never; Returns: Json }
      bp_week_record: {
        Args: {
          p_diastolic: number
          p_measured_at: string
          p_pulse: number
          p_slot: string
          p_submission: string
          p_systolic: number
          p_week: string
        }
        Returns: Json
      }
      bp_week_record_for: {
        Args: {
          p_diastolic: number
          p_measured_at: string
          p_member: string
          p_pulse: number
          p_slot: string
          p_submission: string
          p_systolic: number
          p_week: string
        }
        Returns: Json
      }
      bp_week_record_sourced: {
        Args: {
          p_diastolic: number
          p_entry_source: string
          p_measured_at: string
          p_pulse: number
          p_slot: string
          p_submission: string
          p_systolic: number
          p_week: string
        }
        Returns: Json
      }
      bp_week_reminders_run: { Args: { p_now?: string }; Returns: Json }
      bp_week_set_reminders: {
        Args: { p_on: boolean; p_week: string }
        Returns: Json
      }
      bp_week_staff_read: { Args: { p_member: string }; Returns: Json }
      bp_week_start: {
        Args: {
          p_evening: string
          p_member: string
          p_morning: string
          p_starts_on: string
        }
        Returns: Json
      }
      bp_week_stop: {
        Args: { p_reason: string; p_week: string }
        Returns: Json
      }
      bp_weekly_summary_run: { Args: { p_now?: string }; Returns: Json }
      cancel_booking_appointment: {
        Args: {
          p_actor: string
          p_agreement_source?: string
          p_appointment_id: string
          p_command_id: string
          p_member: string
          p_revision: number
          p_sender_email?: string
          p_subject?: string
          p_template_version?: string
          p_text_content?: string
        }
        Returns: Json
      }
      care_alert_acknowledge: {
        Args: { p_alert: string; p_expected_seq: number }
        Returns: Json
      }
      care_alert_assessments_retry: { Args: { p_limit: number }; Returns: Json }
      care_alert_audit_log: { Args: { p_alert: string }; Returns: Json }
      care_alert_bp_flags_retry: { Args: { p_limit: number }; Returns: Json }
      care_alert_escalate_due: { Args: never; Returns: Json }
      care_alert_inbox: {
        Args: { p_limit?: number; p_view?: string }
        Returns: Json
      }
      care_alert_member_status: {
        Args: { p_zoe_request?: string }
        Returns: Json
      }
      care_alert_messages_pending: {
        Args: { p_limit: number; p_with_text: boolean }
        Returns: Json
      }
      care_alert_next_action: {
        Args: {
          p_alert: string
          p_due_at?: string
          p_expected_seq: number
          p_text: string
        }
        Returns: Json
      }
      care_alert_nurse_inbox: { Args: { p_limit?: number }; Returns: Json }
      care_alert_resolution_record: { Args: { p_alert: string }; Returns: Json }
      care_alert_resolve: {
        Args: {
          p_alert: string
          p_expected_seq: number
          p_note: string
          p_resolution: string
        }
        Returns: Json
      }
      care_alert_routing_read: { Args: never; Returns: Json }
      care_alert_routing_set: {
        Args: {
          p_backup?: string
          p_minutes?: number
          p_primary: string
          p_source: string
        }
        Returns: Json
      }
      care_alert_screen: {
        Args: {
          p_member: string
          p_outcome: string
          p_reason: string
          p_red_flags: string[]
          p_rule: string
          p_rule_version: string
          p_source: string
          p_source_ref: string
        }
        Returns: Json
      }
      care_alert_zoe_urgent_retry: { Args: { p_limit: number }; Returns: Json }
      care_queue_inbox: {
        Args: { p_queue: string; p_view?: string }
        Returns: Json
      }
      care_queue_mark: {
        Args: { p_expected_seq: number; p_task: string; p_to: string }
        Returns: Json
      }
      care_queue_member_tasks: { Args: never; Returns: Json }
      care_queue_raise: {
        Args: {
          p_action: string
          p_member: string
          p_queue: string
          p_reason: string
          p_red_flags: string
          p_rule_version: string
          p_sla: string
          p_source_ref: string
          p_summary: Json
          p_zone: string
        }
        Returns: Json
      }
      channel_inbox_card_text: {
        Args: { p_card: string; p_press: string; p_text: string }
        Returns: Json
      }
      channel_inbox_commit: { Args: { p_event: Json }; Returns: Json }
      channel_inbox_next: { Args: { p_limit: number }; Returns: Json }
      channel_inbox_press_done: {
        Args: { p_id: string; p_result: string }
        Returns: Json
      }
      channel_inbox_process:
        | { Args: { p_id: string }; Returns: Json }
        | {
            Args: { p_doctor_telegram_enabled: boolean; p_id: string }
            Returns: Json
          }
      channel_inbox_reject: {
        Args: { p_event_id: string; p_reason: string }
        Returns: Json
      }
      channel_side_effect_nurse_task: {
        Args: { p_member: string; p_request_id: string; p_what: string }
        Returns: Json
      }
      claim_auth_sms_hook:
        | {
            Args: { p_body_digest: string; p_webhook_id: string }
            Returns: Json
          }
        | {
            Args: {
              p_body_digest: string
              p_channel: string
              p_provider: string
              p_webhook_id: string
            }
            Returns: Json
          }
      claim_auth_sms_hook_bound: {
        Args: {
          p_body_digest: string
          p_channel: string
          p_provider: string
          p_verification_digest: string
          p_webhook_id: string
        }
        Returns: Json
      }
      claim_auth_sms_verify_hook:
        | {
            Args: {
              p_body_digest: string
              p_verification_digest: string
              p_webhook_id: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_body_digest: string
              p_recipient_digest: string
              p_verification_digest: string
              p_webhook_id: string
            }
            Returns: Json
          }
      claim_auth_verify_feedback: {
        Args: { p_verification_digest: string }
        Returns: Json
      }
      claim_booking_notice: {
        Args: {
          p_attempt: string
          p_engine: string
          p_generation: number
          p_lease_until: string
          p_notice: string
          p_sender: string
          p_template: string
        }
        Returns: Json
      }
      claim_demo_report_ai:
        | {
            Args: { p_request_id: string; p_session_hash: string }
            Returns: boolean
          }
        | {
            Args: {
              p_category: string
              p_request_id: string
              p_session_hash: string
            }
            Returns: boolean
          }
      claim_native_member_request: {
        Args: { p_owner: string }
        Returns: {
          allowed: boolean
          retry_after: number
        }[]
      }
      claim_patient_message_source: {
        Args: { p_plan_id: string }
        Returns: string
      }
      claim_report_job: {
        Args: {
          p_id: string
          p_operation: string
          p_owner: string
          p_revision: number
        }
        Returns: number
      }
      claim_workspace_admission: {
        Args: { p_email?: string; p_operation: string; p_source: string }
        Returns: number
      }
      cleanup_run_finish: {
        Args: {
          p_attempted: number
          p_cleaned: number
          p_failed: number
          p_failure_category: string
          p_run_id: string
        }
        Returns: undefined
      }
      cleanup_run_start: { Args: { p_run_id: string }; Returns: undefined }
      clear_workspace_login_source: {
        Args: { p_email: string; p_source: string }
        Returns: undefined
      }
      clinic_admin_account_lookup: { Args: { p_email: string }; Returns: Json }
      clinic_admin_change_decide: {
        Args: {
          p_clinic: string
          p_decision: string
          p_note?: string
          p_request: string
        }
        Returns: Json
      }
      clinic_admin_change_request: {
        Args: {
          p_clinic: string
          p_expected: Json
          p_kind: string
          p_member: string
          p_proposed: Json
          p_submission: string
        }
        Returns: Json
      }
      clinic_admin_change_requests: {
        Args: { p_clinic: string; p_state?: string }
        Returns: Json
      }
      clinic_admin_member_file_attach: {
        Args: {
          p_appointment?: string
          p_clinic: string
          p_confirm?: boolean
          p_file: string
          p_member: string
          p_reason?: string
          p_submission: string
        }
        Returns: Json
      }
      clinic_admin_member_files: {
        Args: { p_clinic: string; p_member: string }
        Returns: Json
      }
      clinic_admin_member_reveal: {
        Args: { p_clinic: string; p_member: string; p_reason: string }
        Returns: Json
      }
      clinic_admin_member_upload_register: {
        Args: { p_batch: string; p_clinic: string; p_member: string }
        Returns: Json
      }
      clinic_admin_membership_command: {
        Args: { p_command: Json }
        Returns: Json
      }
      clinic_admin_membership_refresh: {
        Args: { p_command: Json }
        Returns: Json
      }
      clinic_admin_memberships_page: {
        Args: { p_clinic_id: string; p_cursor?: string; p_limit?: number }
        Returns: Json
      }
      clinic_admin_original_open: { Args: { p_file: string }; Returns: Json }
      clinic_admin_patient_care_team: {
        Args: {
          p_clinic: string
          p_doctor: string
          p_expected_revision: number
          p_member: string
          p_nurse?: string
        }
        Returns: Json
      }
      clinic_admin_patient_profile_update: {
        Args: {
          p_birth_date: string
          p_clinic: string
          p_expected: Json
          p_member: string
          p_name: string
          p_submission: string
        }
        Returns: Json
      }
      clinic_admin_patient_record: {
        Args: { p_clinic: string; p_member: string }
        Returns: Json
      }
      clinic_admin_patients: {
        Args: { p_clinic: string; p_query?: string }
        Returns: Json
      }
      clinic_audit_log: {
        Args: {
          p_actor?: string
          p_category?: string
          p_clinic: string
          p_cursor?: string
          p_from?: string
          p_limit?: number
          p_member?: string
          p_profile_values?: boolean
          p_to?: string
        }
        Returns: Json
      }
      clinic_audit_log_export: {
        Args: {
          p_actor?: string
          p_category?: string
          p_clinic: string
          p_from?: string
          p_member?: string
          p_profile_values?: boolean
          p_to?: string
        }
        Returns: Json
      }
      clinic_audit_people: { Args: { p_clinic: string }; Returns: Json }
      clinic_batch_command: { Args: { p_command: Json }; Returns: Json }
      clinic_batch_read: {
        Args: {
          p_batch_id: string
          p_clinic_id: string
          p_cursor?: string
          p_limit?: number
        }
        Returns: Json
      }
      clinic_batch_refresh: {
        Args: { p_batch_id: string; p_clinic_id: string; p_command: Json }
        Returns: Json
      }
      clinic_batches_page: {
        Args: { p_clinic_id: string; p_cursor?: string; p_limit?: number }
        Returns: Json
      }
      clinic_invitation_account: {
        Args: { p_generation: number; p_invitation_id: string }
        Returns: Json
      }
      clinic_invitation_clear_password: {
        Args: {
          p_generation: number
          p_invitation_id: string
          p_nonce_hmac: string
        }
        Returns: Json
      }
      clinic_invitation_finalize: {
        Args: {
          p_generation: number
          p_invitation_id: string
          p_nonce_hmac: string
        }
        Returns: Json
      }
      clinic_invitation_reissue: {
        Args: {
          p_expected_generation: number
          p_invitation_id: string
          p_phone: string
        }
        Returns: Json
      }
      clinic_invitation_reserve: {
        Args: {
          p_clinic_id: string
          p_display_name: string
          p_email: string
          p_phone: string
          p_request_id: string
        }
        Returns: Json
      }
      clinic_invitation_revoke: {
        Args: { p_expected_generation: number; p_invitation_id: string }
        Returns: Json
      }
      clinic_invitation_telegram_issue: {
        Args: {
          p_auth_user_id: string
          p_generation: number
          p_invitation_id: string
        }
        Returns: Json
      }
      clinic_invitations_list: { Args: { p_clinic_id: string }; Returns: Json }
      clinic_invite_code_begin: {
        Args: {
          p_code_hmac: string
          p_generation: number
          p_invitation_id: string
          p_nonce_hmac: string
          p_start_token_hash: string
        }
        Returns: Json
      }
      clinic_invite_code_verify: {
        Args: {
          p_challenge: string
          p_code_hmac: string
          p_generation: number
          p_invitation_id: string
          p_nonce_hmac: string
        }
        Returns: Json
      }
      clinic_member_file: {
        Args: { p_clinic: string; p_member: string }
        Returns: Json
      }
      clinic_member_file_download: {
        Args: { p_clinic: string; p_file: string; p_member: string }
        Returns: Json
      }
      clinic_member_masked: {
        Args: { p_clinic: string; p_members: string[] }
        Returns: Json
      }
      clinic_member_search: {
        Args: { p_clinic: string; p_page?: number; p_query: string }
        Returns: Json
      }
      clinic_original_access: { Args: { p_file: string }; Returns: Json }
      clinic_original_target: { Args: { p_access: string }; Returns: Json }
      clinic_portal_identity: { Args: { p_clinic_id?: string }; Returns: Json }
      clinic_portal_lab_link: {
        Args: { p_clinic: string; p_command: Json }
        Returns: Json
      }
      clinic_portal_lab_members: { Args: { p_clinic: string }; Returns: Json }
      clinic_portal_lab_results: {
        Args: { p_batch: string; p_clinic: string }
        Returns: Json
      }
      clinic_portal_result_attach: {
        Args: { p_clinic: string; p_command: Json }
        Returns: Json
      }
      clinic_portal_result_visits: { Args: { p_clinic: string }; Returns: Json }
      clinic_result_attach_command: { Args: { p_command: Json }; Returns: Json }
      clinic_result_attach_page: { Args: { p_clinic: string }; Returns: Json }
      clinic_result_detach_command: { Args: { p_command: Json }; Returns: Json }
      clinic_schedule_bookings: {
        Args: {
          p_clinic: string
          p_day?: string
          p_scope?: string
          p_status?: string
        }
        Returns: Json
      }
      clinic_schedule_command: {
        Args: { p_clinic: string; p_command: Json }
        Returns: Json
      }
      clinic_schedule_free_slots: {
        Args: { p_clinic: string; p_day: string }
        Returns: Json
      }
      clinic_schedule_settings: { Args: { p_clinic: string }; Returns: Json }
      clinic_schedule_settings_save: {
        Args: { p_clinic: string; p_settings: Json }
        Returns: Json
      }
      clinic_schedule_team: { Args: { p_clinic: string }; Returns: Json }
      clinic_schedule_team_command: {
        Args: { p_clinic: string; p_command: Json }
        Returns: Json
      }
      clinic_schedule_top_up: { Args: never; Returns: number }
      clinic_upload_cleanup: { Args: { p_file: string }; Returns: Json }
      clinic_upload_cleanup_pending: {
        Args: { p_limit?: number }
        Returns: Json
      }
      clinic_upload_execution_end: {
        Args: { p_attempt: string; p_file: string; p_outcome: Json }
        Returns: Json
      }
      clinic_upload_finalize: {
        Args: {
          p_file: string
          p_object: string
          p_sha256: string
          p_size: number
        }
        Returns: Json
      }
      clinic_upload_target: {
        Args: { p_actor: string; p_file: string; p_session: string }
        Returns: Json
      }
      command_patient_clinical_review: {
        Args: {
          p_evidence_token: string
          p_expected_revision: number
          p_input: Json
          p_operation: string
          p_user_id: string
        }
        Returns: number
      }
      command_patient_clinical_review_before_clinic_lab: {
        Args: {
          p_evidence_token: string
          p_expected_revision: number
          p_input: Json
          p_operation: string
          p_user_id: string
        }
        Returns: number
      }
      command_patient_clinical_review_before_lab_match: {
        Args: {
          p_evidence_token: string
          p_expected_revision: number
          p_input: Json
          p_operation: string
          p_user_id: string
        }
        Returns: number
      }
      command_patient_clinical_review_before_required_evidence: {
        Args: {
          p_evidence_token: string
          p_expected_revision: number
          p_input: Json
          p_operation: string
          p_user_id: string
        }
        Returns: number
      }
      command_patient_test_request: {
        Args: {
          p_actor: string
          p_command_id: string
          p_id: string
          p_input: Json
          p_operation: string
          p_revision: number
          p_staff: boolean
          p_user_id: string
        }
        Returns: Json
      }
      complete_patient_message_source: {
        Args: { p_claim_token: string; p_plan_id: string }
        Returns: boolean
      }
      configure_auth_verify_spend: {
        Args: {
          p_ceiling_micros: number
          p_expected_revision: number
          p_operator_label: string
        }
        Returns: boolean
      }
      configure_patient_message_spend: {
        Args: {
          p_expected_revision: number
          p_operator_label: string
          p_policy: Json
        }
        Returns: boolean
      }
      configure_patient_message_spend_before_auth_hook: {
        Args: {
          p_expected_revision: number
          p_operator_label: string
          p_policy: Json
        }
        Returns: boolean
      }
      conversation_actions: { Args: { p_member: string }; Returns: Json }
      conversation_awaiting_replies: { Args: never; Returns: Json }
      conversation_claim: {
        Args: { p_attempt: string; p_delivery: string }
        Returns: Json
      }
      conversation_command: { Args: { p_command: Json }; Returns: Json }
      conversation_compose: {
        Args: {
          p_body: string
          p_expected_clinical_revision: number
          p_expected_draft_epoch: number
          p_expected_source: string
          p_expected_version: number
          p_member: string
          p_request_id: string
          p_summary: string
        }
        Returns: Json
      }
      conversation_draft_reject_reason: {
        Args: { p_draft: string; p_note?: string; p_reason: string }
        Returns: Json
      }
      conversation_edit_summary: {
        Args: {
          p_draft: string
          p_expected_revision: number
          p_member: string
          p_request_id: string
          p_summary: string
        }
        Returns: Json
      }
      conversation_intake_workspace: {
        Args: { p_member: string }
        Returns: Json
      }
      conversation_intake_workspace_unlogged: {
        Args: { p_member: string }
        Returns: Json
      }
      conversation_member_new_topic: { Args: never; Returns: Json }
      conversation_member_thread: { Args: never; Returns: Json }
      conversation_member_thread_before_nurse: { Args: never; Returns: Json }
      conversation_member_voice_receipt: {
        Args: { p_seq: number }
        Returns: Json
      }
      conversation_nurse_handoff: {
        Args: {
          p_expected_version: number
          p_member: string
          p_message_id: string
          p_observation: string
          p_request_id: string
          p_topic: string
        }
        Returns: Json
      }
      conversation_nurse_handoffs: {
        Args: { p_member?: string }
        Returns: Json
      }
      conversation_nurse_reply: {
        Args: {
          p_body: string
          p_expected_version: number
          p_member: string
          p_request_id: string
        }
        Returns: Json
      }
      conversation_nurse_workspace:
        | { Args: { p_member: string }; Returns: Json }
        | {
            Args: { p_member: string; p_telegram_enabled: boolean }
            Returns: Json
          }
      conversation_outcome: {
        Args: { p_attempt: string; p_outcome: Json }
        Returns: Json
      }
      conversation_propose: {
        Args: {
          p_body: string
          p_expected_clinical_revision: number
          p_expected_draft_epoch: number
          p_expected_source: string
          p_expected_version: number
          p_member: string
          p_provenance: Json
          p_request_id: string
          p_summary: string
        }
        Returns: Json
      }
      conversation_receive:
        | { Args: { p_command: Json; p_to_doctor?: boolean }; Returns: Json }
        | {
            Args: {
              p_command: Json
              p_to_doctor: boolean
              p_voice_receipt: string
            }
            Returns: Json
          }
      conversation_reconcile: { Args: { p_attempt: string }; Returns: Json }
      conversation_recover: {
        Args: { p_member: string; p_payload: Json; p_request_id: string }
        Returns: Json
      }
      conversation_retry_delivery: {
        Args: { p_delivery: string }
        Returns: Json
      }
      conversation_retry_workspace: {
        Args: { p_member: string }
        Returns: Json
      }
      conversation_revoke_grant: { Args: never; Returns: boolean }
      conversation_trace: {
        Args: { p_before?: number; p_member: string }
        Returns: Json
      }
      conversation_trace_members: { Args: { p_limit?: number }; Returns: Json }
      conversation_trace_unlogged: {
        Args: { p_before?: number; p_member: string }
        Returns: Json
      }
      conversation_unassigned_members: { Args: never; Returns: Json }
      conversation_workspace: { Args: { p_member?: string }; Returns: Json }
      conversation_workspace_unlogged: {
        Args: { p_member?: string }
        Returns: Json
      }
      conversation_zoe_answered: { Args: never; Returns: Json }
      create_patient_test_request: {
        Args: {
          p_algorithm_version: string
          p_context_token: string
          p_request_id: string
          p_requirements: Json
          p_terms: Json
          p_user_id: string
        }
        Returns: Json
      }
      defer_patient_message_reconciliation: {
        Args: {
          p_attempt_id: string
          p_failed: boolean
          p_observed_status?: string
        }
        Returns: boolean
      }
      delivery_observe: {
        Args: { p_attempt: string; p_channel: string; p_outcome: Json }
        Returns: Json
      }
      delivery_reconcile_stale: {
        Args: { p_lease_seconds: number }
        Returns: Json
      }
      doctor_ai_inbox: { Args: never; Returns: Json }
      doctor_ai_plan_adopted: {
        Args: { p_fields: string[]; p_generation: string }
        Returns: Json
      }
      doctor_ai_plan_read: { Args: { p_user_id: string }; Returns: Json }
      doctor_approval_cards_read: { Args: { p_member: string }; Returns: Json }
      doctor_approvals_history: {
        Args: { p_since: string; p_until: string }
        Returns: Json
      }
      doctor_bp_repeat_notes: { Args: never; Returns: Json }
      doctor_chat_conversation: { Args: { p_member: string }; Returns: Json }
      doctor_chat_hand_back: {
        Args: { p_member: string; p_mode_revision: string; p_version: number }
        Returns: Json
      }
      doctor_chat_retry_conversation: {
        Args: { p_member: string }
        Returns: Json
      }
      doctor_clinic_lab_receipt_sources: {
        Args: { p_user_id: string }
        Returns: Json
      }
      doctor_consult_questions: { Args: { p_member: string }; Returns: Json }
      doctor_conversation_topic_breaks: {
        Args: { p_member: string }
        Returns: Json
      }
      doctor_decision_apply: {
        Args: {
          p_id: string
          p_kind: string
          p_member: string
          p_note?: string
          p_revision: string
        }
        Returns: Json
      }
      doctor_decision_item: {
        Args: { p_id: string; p_kind: string }
        Returns: Json
      }
      doctor_decision_items: { Args: { p_member: string }; Returns: Json }
      doctor_decision_reply: { Args: { p_member: string }; Returns: Json }
      doctor_decision_reply_apply: {
        Args: { p_command: Json; p_member: string; p_mode_revision: string }
        Returns: Json
      }
      doctor_first_note_approve: { Args: { p_command: Json }; Returns: Json }
      doctor_first_note_backlog_close: {
        Args: { p_member: string; p_reason: string }
        Returns: Json
      }
      doctor_first_note_backlog_reopen: {
        Args: { p_member: string }
        Returns: Json
      }
      doctor_first_note_card_approve: {
        Args: {
          p_appointments_revision: string
          p_command: Json
          p_evidence_token: string
          p_revision: number
        }
        Returns: Json
      }
      doctor_first_note_queue: { Args: never; Returns: Json }
      doctor_first_note_queue_count: { Args: never; Returns: Json }
      doctor_first_note_read: { Args: { p_user_id: string }; Returns: Json }
      doctor_gp_report_approve: {
        Args: {
          p_content: Json
          p_source_token: string
          p_submission_id: string
          p_user_id: string
        }
        Returns: Json
      }
      doctor_gp_report_source: { Args: { p_user_id: string }; Returns: Json }
      doctor_gp_report_source_unlogged: {
        Args: { p_user_id: string }
        Returns: Json
      }
      doctor_gp_report_version: {
        Args: { p_user_id: string; p_version: number }
        Returns: Json
      }
      doctor_gp_report_version_unlogged: {
        Args: { p_user_id: string; p_version: number }
        Returns: Json
      }
      doctor_inbox_approve: {
        Args: { p_command: Json; p_member: string }
        Returns: Json
      }
      doctor_lab_ai_confirm_passing: {
        Args: { p_command: Json }
        Returns: Json
      }
      doctor_lab_ai_identity_confirm: {
        Args: { p_command: Json }
        Returns: Json
      }
      doctor_lab_ai_overview: { Args: { p_user_id: string }; Returns: Json }
      doctor_lab_ai_overview_unlogged: {
        Args: { p_user_id: string }
        Returns: Json
      }
      doctor_lab_ai_read: {
        Args: { p_file: string; p_user_id: string }
        Returns: Json
      }
      doctor_lab_ai_read_unlogged: {
        Args: { p_file: string; p_user_id: string }
        Returns: Json
      }
      doctor_lab_ai_request: {
        Args: { p_file: string; p_user_id: string }
        Returns: Json
      }
      doctor_lab_ai_value_review: { Args: { p_command: Json }; Returns: Json }
      doctor_ldl_event_add: { Args: { p_command: Json }; Returns: Json }
      doctor_ldl_event_remove: {
        Args: { p_event: string; p_member: string }
        Returns: Json
      }
      doctor_ldl_goal_set: { Args: { p_command: Json }; Returns: Json }
      doctor_ldl_read: { Args: { p_member: string }; Returns: Json }
      doctor_ldl_response_close: {
        Args: { p_note: string; p_response: string }
        Returns: Json
      }
      doctor_ldl_responses: { Args: never; Returns: Json }
      doctor_ldl_retest_cancel: {
        Args: { p_member: string; p_retest: string }
        Returns: Json
      }
      doctor_ldl_therapy_add: { Args: { p_command: Json }; Returns: Json }
      doctor_ldl_therapy_end: {
        Args: {
          p_member: string
          p_reason: string
          p_stopped_on: string
          p_therapy: string
        }
        Returns: Json
      }
      doctor_lipid_planner_read: { Args: { p_member: string }; Returns: Json }
      doctor_medicine_concern_handle: { Args: { p_id: string }; Returns: Json }
      doctor_medicine_concerns: { Args: never; Returns: Json }
      doctor_member_document_command: {
        Args: { p_command: Json }
        Returns: Json
      }
      doctor_member_document_open: {
        Args: { p_file: string; p_user_id: string }
        Returns: Json
      }
      doctor_member_documents: { Args: { p_user_id: string }; Returns: Json }
      doctor_member_documents_unlogged: {
        Args: { p_user_id: string }
        Returns: Json
      }
      doctor_member_plan_versions: {
        Args: { p_user_id: string }
        Returns: Json
      }
      doctor_member_plan_versions_unlogged: {
        Args: { p_user_id: string }
        Returns: Json
      }
      doctor_member_upload_approve: { Args: { p_command: Json }; Returns: Json }
      doctor_member_uploads_waiting: { Args: never; Returns: Json }
      doctor_mismatched_uploads: { Args: { p_member?: string }; Returns: Json }
      doctor_programme_confirm: {
        Args: {
          p_checkpoint: string
          p_note: string
          p_submission: string
          p_user_id: string
        }
        Returns: Json
      }
      doctor_programme_member: { Args: { p_user_id: string }; Returns: Json }
      doctor_programme_queue: { Args: never; Returns: Json }
      doctor_regimen_review: { Args: { p_user_id: string }; Returns: Json }
      doctor_required_evidence_sources: {
        Args: { p_user_id: string }
        Returns: Json
      }
      doctor_result_entry_save: {
        Args: {
          p_field: string
          p_finding: string
          p_number: number
          p_observed_on: string
          p_submission_id: string
          p_user_id: string
        }
        Returns: Json
      }
      doctor_saved_plans: { Args: never; Returns: Json }
      doctor_telegram_abandon: {
        Args: { p_doctor: string; p_session: string }
        Returns: Json
      }
      doctor_telegram_action_admit: {
        Args: { p_connection: string; p_generation: number; p_lease: string }
        Returns: Json
      }
      doctor_telegram_begin_refresh: {
        Args: { p_connection: string; p_generation: number; p_lease: string }
        Returns: Json
      }
      doctor_telegram_close: {
        Args: { p_connection: string; p_generation: number; p_lease: string }
        Returns: Json
      }
      doctor_telegram_disconnect: { Args: { p_doctor: string }; Returns: Json }
      doctor_telegram_finish_refresh: {
        Args: {
          p_ciphertext: string
          p_connection: string
          p_generation: number
          p_key_version: string
          p_lease: string
          p_nonce: string
        }
        Returns: Json
      }
      doctor_telegram_inbox_claim: {
        Args: { p_connection: string; p_generation: number; p_id: string }
        Returns: Json
      }
      doctor_telegram_inbox_done: {
        Args: {
          p_connection: string
          p_generation: number
          p_id: string
          p_result: string
        }
        Returns: Json
      }
      doctor_telegram_open: {
        Args: {
          p_binding: string
          p_binding_generation: number
          p_ciphertext: string
          p_doctor: string
          p_generation: number
          p_key_version: string
          p_nonce: string
          p_session: string
        }
        Returns: Json
      }
      doctor_telegram_quarantine: {
        Args: { p_connection: string; p_generation: number; p_lease: string }
        Returns: Json
      }
      doctor_telegram_release_lease: {
        Args: { p_connection: string; p_generation: number; p_lease: string }
        Returns: Json
      }
      doctor_telegram_status: { Args: { p_doctor: string }; Returns: Json }
      doctor_telegram_sweep: { Args: never; Returns: Json }
      doctor_telegram_take_lease: {
        Args: { p_connection: string; p_generation: number }
        Returns: Json
      }
      doctor_urgent_windows: { Args: never; Returns: Json }
      doctor_zoe_answered_mark: {
        Args: { p_action: string; p_member: string; p_version: number }
        Returns: Json
      }
      doctor_zoe_clear_urgent: { Args: { p_member: string }; Returns: Json }
      doctor_zoe_coach: { Args: { p_member: string }; Returns: Json }
      doctor_zoe_coach_resume: { Args: { p_member: string }; Returns: Json }
      doctor_zoe_hand_back: { Args: { p_member: string }; Returns: Json }
      doctor_zoe_mode: { Args: { p_member: string }; Returns: Json }
      doctor_zoe_urgent_window: { Args: { p_member: string }; Returns: Json }
      enqueue_patient_plan_message: {
        Args: { p_plan_id: string }
        Returns: string
      }
      enroll_patient_clinical_case: { Args: never; Returns: string }
      finish_auth_sms_hook: {
        Args: {
          p_claim_token: string
          p_reference?: string
          p_status: string
          p_webhook_id: string
        }
        Returns: boolean
      }
      finish_auth_verify_feedback: {
        Args: { p_claim_token: string; p_status: string; p_webhook_id: string }
        Returns: boolean
      }
      finish_patient_message_submission: {
        Args: {
          p_attempt_id: string
          p_provider_reference: string
          p_status: string
        }
        Returns: boolean
      }
      finish_patient_message_submission_uncontrolled: {
        Args: {
          p_attempt_id: string
          p_provider_reference: string
          p_status: string
        }
        Returns: boolean
      }
      health_ping: { Args: never; Returns: boolean }
      job_run_finish: {
        Args: {
          p_counts: Json
          p_error_code: string
          p_outcome: string
          p_run: string
        }
        Returns: boolean
      }
      job_run_start: {
        Args: { p_job: string; p_max_seconds: number; p_trigger: string }
        Returns: string
      }
      lab_ai_call_finish: {
        Args: { p_call: string; p_result: Json }
        Returns: Json
      }
      lab_ai_call_reserve: {
        Args: {
          p_estimate_usd: number
          p_job: string
          p_lease: string
          p_local: boolean
          p_model: string
          p_purpose: string
          p_tier: string
        }
        Returns: Json
      }
      lab_ai_file_target: { Args: { p_job: string }; Returns: Json }
      lab_ai_job_claim: { Args: { p_limit: number }; Returns: Json }
      lab_ai_job_finish: {
        Args: { p_job: string; p_lease: string; p_result: Json }
        Returns: Json
      }
      lab_ai_reading_state: { Args: never; Returns: Json }
      ldl_response_candidates: { Args: { p_limit?: number }; Returns: Json }
      ldl_response_record: { Args: { p_command: Json }; Returns: Json }
      ldl_response_run: { Args: { p_now?: string }; Returns: Json }
      ldl_response_skip: {
        Args: { p_keys: string[]; p_member: string }
        Returns: number
      }
      lock_assigned_clinical_case: {
        Args: {
          p_actor: string
          p_revision: number
          p_token: string
          p_user_id: string
        }
        Returns: {
          assigned_doctor_id: string | null
          assigned_nurse_id: string | null
          created_at: string
          draft: Json | null
          draft_evidence_token: string | null
          draft_lab_token: string | null
          draft_review_token: string | null
          draft_saved_at: string | null
          draft_saved_by: string | null
          review: Json | null
          revision: number
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "patient_clinical_cases"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      lock_assigned_clinical_case_before_managed_session: {
        Args: {
          p_actor: string
          p_revision: number
          p_token: string
          p_user_id: string
        }
        Returns: {
          assigned_doctor_id: string | null
          assigned_nurse_id: string | null
          created_at: string
          draft: Json | null
          draft_evidence_token: string | null
          draft_lab_token: string | null
          draft_review_token: string | null
          draft_saved_at: string | null
          draft_saved_by: string | null
          review: Json | null
          revision: number
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "patient_clinical_cases"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      lock_patient_clinical_sources: {
        Args: { p_user_id: string }
        Returns: undefined
      }
      mark_stale_patient_message_submissions: { Args: never; Returns: number }
      mark_stale_patient_message_submissions_uncontrolled: {
        Args: never
        Returns: number
      }
      member_bp_read_for: { Args: { p_member: string }; Returns: Json }
      member_bp_recent: { Args: { p_member?: string }; Returns: Json }
      member_cancel_callback: { Args: { p_request: string }; Returns: Json }
      member_clinic_measurements: { Args: never; Returns: Json }
      member_contact_status: { Args: never; Returns: Json }
      member_ldl_read: { Args: never; Returns: Json }
      member_ldl_read_for: { Args: { p_member: string }; Returns: Json }
      member_lesson_done_set: {
        Args: { p_done: boolean; p_lesson: string }
        Returns: Json
      }
      member_lesson_offer: { Args: { p_lesson: string }; Returns: Json }
      member_lesson_offer_dismiss: { Args: never; Returns: Json }
      member_lessons_read: { Args: never; Returns: Json }
      member_measurement_record_for: {
        Args: {
          p_diastolic: number
          p_measured_at: string
          p_member: string
          p_pulse: number
          p_submission: string
          p_systolic: number
        }
        Returns: Json
      }
      member_medicine_add: {
        Args: {
          p_dose: string
          p_name: string
          p_request_id?: string
          p_times: string[]
        }
        Returns: Json
      }
      member_medicine_ask_answer: {
        Args: { p_ask: string; p_reason: string }
        Returns: Json
      }
      member_medicine_ask_answer_for: {
        Args: { p_ask: string; p_member: string; p_reason: string }
        Returns: Json
      }
      member_medicine_ask_care_team: { Args: { p_ask: string }; Returns: Json }
      member_medicine_ask_dismiss: { Args: { p_ask: string }; Returns: Json }
      member_medicine_ask_mine: { Args: { p_ask: string }; Returns: Json }
      member_medicine_ask_open_for: {
        Args: { p_ask: string; p_member: string }
        Returns: Json
      }
      member_medicine_asks_read: { Args: never; Returns: Json }
      member_medicine_asks_read_for: {
        Args: { p_member: string }
        Returns: Json
      }
      member_medicine_asks_run: { Args: { p_now?: string }; Returns: Json }
      member_medicine_details_read: { Args: never; Returns: Json }
      member_medicine_dose_report: {
        Args: {
          p_due_at: string
          p_expected_revision: number
          p_medicine: string
          p_status: string
        }
        Returns: Json
      }
      member_medicine_dose_report_for: {
        Args: {
          p_due_at: string
          p_expected_revision: number
          p_medicine: string
          p_member: string
          p_status: string
        }
        Returns: Json
      }
      member_medicine_reasons_staff_read: {
        Args: { p_days: number; p_member: string }
        Returns: Json
      }
      member_medicine_reminders_run: { Args: { p_now?: string }; Returns: Json }
      member_medicine_restore: { Args: { p_id: string }; Returns: Json }
      member_medicine_stop: { Args: { p_id: string }; Returns: Json }
      member_medicine_update: {
        Args: { p_dose: string; p_id: string; p_times: string[] }
        Returns: Json
      }
      member_medicine_update_times: {
        Args: { p_expected_dose: string; p_id: string; p_times: string[] }
        Returns: Json
      }
      member_medicines_read: { Args: never; Returns: Json }
      member_medicines_read_for: { Args: { p_member: string }; Returns: Json }
      member_medicines_review: {
        Args: { p_added: Json; p_changes: Json }
        Returns: Json
      }
      member_medicines_staff_read: {
        Args: { p_days: number; p_member: string }
        Returns: Json
      }
      member_notice_reminders_run: { Args: { p_now?: string }; Returns: Json }
      member_notices_mark_seen: { Args: { p_id: string }; Returns: Json }
      member_notices_read: { Args: never; Returns: Json }
      member_plan_doses_read_for: { Args: { p_member: string }; Returns: Json }
      member_plan_read_for: { Args: { p_member: string }; Returns: Json }
      member_profile_card_save: {
        Args: { p_caregiver: Json; p_channel: string }
        Returns: Json
      }
      member_programme_checkin_submit: {
        Args: {
          p_checkpoint: string
          p_feeling: string
          p_medicines: string
          p_note: string
          p_submission: string
        }
        Returns: Json
      }
      member_programme_timeline: { Args: never; Returns: Json }
      member_push_claim: { Args: { p_limit?: number }; Returns: Json }
      member_push_outcome: {
        Args: { p_attempt: string; p_delivery: string; p_outcome: string }
        Returns: Json
      }
      member_push_subscribe: {
        Args: { p_auth: string; p_endpoint: string; p_p256dh: string }
        Returns: Json
      }
      member_push_unsubscribe: { Args: { p_endpoint: string }; Returns: Json }
      member_reported_document_remove: {
        Args: { p_id: string }
        Returns: string
      }
      member_reported_value_add: {
        Args: {
          p_measure: string
          p_measured_on: string
          p_unit: string
          p_value: number
          p_value2: number
        }
        Returns: string
      }
      member_reported_value_remove: { Args: { p_id: string }; Returns: boolean }
      member_request_callback: { Args: { p_from: string }; Returns: Json }
      member_results_read_for: { Args: { p_member: string }; Returns: Json }
      member_safety_backfill: { Args: never; Returns: number }
      member_safety_hide_today: { Args: { p_hold: string }; Returns: Json }
      member_safety_status: { Args: never; Returns: Json }
      member_side_effect_nurse_task: {
        Args: { p_request_id: string; p_what: string }
        Returns: Json
      }
      member_upload_ai_edit: { Args: { p_command: Json }; Returns: Json }
      member_upload_ai_identity: { Args: { p_command: Json }; Returns: Json }
      member_upload_ai_overview: { Args: never; Returns: Json }
      member_upload_ai_read: { Args: { p_document: string }; Returns: Json }
      member_upload_results: { Args: never; Returns: Json }
      member_visits_read_for: { Args: { p_member: string }; Returns: Json }
      message_is_quiet: {
        Args: { p_at: string; p_end: string; p_start: string }
        Returns: boolean
      }
      nurse_sent_handoffs: { Args: never; Returns: Json }
      nurse_visit_collect: { Args: { p_command: Json }; Returns: Json }
      nurse_visit_complete: { Args: { p_command: Json }; Returns: Json }
      nurse_visit_detail: {
        Args: { p_id: string; p_member: string; p_source: string }
        Returns: Json
      }
      nurse_visit_list: { Args: never; Returns: Json }
      nurse_visit_mark: { Args: { p_command: Json }; Returns: Json }
      nurse_visit_navigation: { Args: never; Returns: boolean }
      nurse_visit_record: { Args: { p_member: string }; Returns: Json }
      nurse_visit_step: { Args: { p_command: Json }; Returns: Json }
      patient_care_plan_regimens: { Args: never; Returns: Json }
      patient_care_plan_versions: { Args: never; Returns: Json }
      patient_care_team: { Args: never; Returns: Json }
      patient_clinical_case_queue: { Args: never; Returns: Json }
      patient_clinical_case_search: {
        Args: {
          p_after_created_at?: string
          p_after_user_id?: string
          p_query: string
        }
        Returns: Json
      }
      patient_clinical_case_search_identity: {
        Args: {
          p_after_created_at?: string
          p_after_user_id?: string
          p_query: string
        }
        Returns: Json
      }
      patient_clinical_case_snapshot: {
        Args: { p_user_id: string }
        Returns: Json
      }
      patient_clinical_case_snapshot_before_review: {
        Args: { p_user_id: string }
        Returns: Json
      }
      patient_clinical_case_snapshot_doctor: {
        Args: { p_user_id: string }
        Returns: Json
      }
      patient_clinical_case_snapshot_unlogged: {
        Args: { p_user_id: string }
        Returns: Json
      }
      patient_clinical_case_status: { Args: never; Returns: Json }
      patient_clinical_doctor_directory: { Args: never; Returns: Json }
      patient_clinical_evidence: { Args: { p_user_id: string }; Returns: Json }
      patient_clinical_nurse_directory: { Args: never; Returns: Json }
      patient_coordination_access: {
        Args: { p_case: string }
        Returns: boolean
      }
      patient_coordination_command: {
        Args: {
          p_case: string
          p_expected_revision: number
          p_input: Json
          p_operation: string
          p_request: string
          p_task: string
        }
        Returns: Json
      }
      patient_coordination_command_before_nurse_handoffs: {
        Args: {
          p_case: string
          p_expected_revision: number
          p_input: Json
          p_operation: string
          p_request: string
          p_task: string
        }
        Returns: Json
      }
      patient_coordination_members: {
        Args: {
          p_after_created_at?: string
          p_after_id?: string
          p_limit?: number
          p_search?: string
        }
        Returns: Json
      }
      patient_coordination_queue: {
        Args: {
          p_after_created_at?: string
          p_after_id?: string
          p_case?: string
          p_filter?: string
          p_limit?: number
        }
        Returns: Json
      }
      patient_coordination_snapshot: { Args: { p_task: string }; Returns: Json }
      patient_coordination_snapshot_unlogged: {
        Args: { p_task: string }
        Returns: Json
      }
      patient_current_published_clinical_review: { Args: never; Returns: Json }
      patient_first_note: { Args: never; Returns: Json }
      patient_member_lab_stages: { Args: never; Returns: Json }
      patient_member_nurse_visit: { Args: never; Returns: Json }
      patient_message_attention: {
        Args: {
          p_before_id?: string
          p_before_started_at?: string
          p_include_acknowledged?: boolean
          p_limit?: number
        }
        Returns: {
          acknowledged: boolean
          attempt_id: string
          evidence: string
          reason: string
          reconcile_failures: number
          started_at: string
          submission_status: string
        }[]
      }
      patient_message_attention_fact: {
        Args: { p_attempt_id: string }
        Returns: {
          evidence: string
          reason: string
        }[]
      }
      patient_message_queue_candidates:
        | {
            Args: { p_limit?: number }
            Returns: {
              job_id: string
            }[]
          }
        | {
            Args: { p_available_channels: string[]; p_limit: number }
            Returns: {
              job_id: string
            }[]
          }
      patient_message_reconciliation_candidates: {
        Args: { p_limit?: number }
        Returns: {
          attempt_id: string
          provider_reference: string
        }[]
      }
      patient_plan_message_candidates: {
        Args: {
          p_after_id?: string
          p_after_published_at?: string
          p_limit?: number
        }
        Returns: {
          plan_id: string
          published_at: string
        }[]
      }
      patient_plan_preparing: { Args: never; Returns: boolean }
      patient_published_clinical_reviews: { Args: never; Returns: Json }
      patient_released_document_open: {
        Args: { p_file: string }
        Returns: Json
      }
      patient_released_documents: { Args: never; Returns: Json }
      patient_staff_care_command: {
        Args: {
          p_id: string
          p_input: Json
          p_operation: string
          p_revision: number
        }
        Returns: number
      }
      patient_staff_lab_stage_command: {
        Args: { p_command: Json }
        Returns: Json
      }
      patient_staff_lab_stages: { Args: { p_member: string }; Returns: Json }
      patient_staff_lab_stages_unlogged: {
        Args: { p_member: string }
        Returns: Json
      }
      patient_staff_visit_command: { Args: { p_command: Json }; Returns: Json }
      patient_staff_visit_refresh: {
        Args: { p_command?: Json; p_member: string; p_visit: string }
        Returns: Json
      }
      patient_staff_visit_workspace: {
        Args: { p_member: string }
        Returns: Json
      }
      patient_staff_visit_workspace_unlogged: {
        Args: { p_member: string }
        Returns: Json
      }
      patient_test_booking_context: { Args: never; Returns: Json }
      patient_test_booking_requests: {
        Args: { p_user_id?: string }
        Returns: Json
      }
      patient_test_booking_requests_unlogged: {
        Args: { p_user_id?: string }
        Returns: Json
      }
      patient_test_context: { Args: { p_user_id: string }; Returns: Json }
      patient_test_request_dto: {
        Args: {
          p_row: Database["public"]["Tables"]["patient_test_requests"]["Row"]
        }
        Returns: Json
      }
      patient_test_staff_context: {
        Args: { p_actor: string; p_id: string }
        Returns: Json
      }
      pilot_admin_payments: { Args: never; Returns: Json }
      pilot_catalog_admin: { Args: never; Returns: Json }
      pilot_catalog_member: { Args: never; Returns: Json }
      pilot_command: { Args: { p_command: Json }; Returns: Json }
      pilot_gm_overview: {
        Args: { p_from: string; p_to: string }
        Returns: Json
      }
      pilot_member_payments: { Args: never; Returns: Json }
      pilot_payment_provider_event: { Args: { p_event: Json }; Returns: Json }
      prepare_patient_clinical_review: {
        Args: {
          p_actor: string
          p_engine: Json
          p_evidence_token: string
          p_expected_revision: number
          p_user_id: string
        }
        Returns: number
      }
      programme_run: { Args: { p_now?: string }; Returns: Json }
      publish_patient_clinical_plan: {
        Args: {
          p_actor: string
          p_engine: Json
          p_evidence_token: string
          p_expected_revision: number
          p_request_id: string
          p_user_id: string
        }
        Returns: string
      }
      publish_patient_clinical_plan_with_summary: {
        Args: {
          p_actor: string
          p_change_summary: string
          p_engine: Json
          p_evidence_token: string
          p_expected_revision: number
          p_request_id: string
          p_user_id: string
        }
        Returns: string
      }
      publish_patient_clinical_regimen: {
        Args: {
          p_actor: string
          p_change_summary: string
          p_engine: Json
          p_evidence_token: string
          p_expected_revision: number
          p_regimen_hash: string
          p_request_id: string
          p_user_id: string
        }
        Returns: string
      }
      rate_limit_claim: {
        Args: {
          p_keys: string[]
          p_kinds: string[]
          p_modes: string[]
          p_operation: string
        }
        Returns: number
      }
      real_admin_booking_slots: { Args: never; Returns: Json }
      real_admin_cleanup_runs: {
        Args: { p_before?: string; p_run_id?: string }
        Returns: Json
      }
      real_admin_clinics: { Args: never; Returns: Json }
      real_admin_close_booking_slot: {
        Args: { p_key: string }
        Returns: boolean
      }
      real_admin_create_booking_slot: {
        Args: { p_capacity: number; p_offer: Json; p_valid_until: string }
        Returns: Json
      }
      real_admin_create_clinic: {
        Args: { p_address: string; p_name: string }
        Returns: Json
      }
      real_admin_doctors: { Args: never; Returns: Json }
      real_admin_job_runs: {
        Args: { p_job?: string; p_limit?: number }
        Returns: Json
      }
      real_admin_operations_summary: { Args: never; Returns: Json }
      real_admin_reissue_doctor_invitation: {
        Args: {
          p_expected_generation: number
          p_invitation_id: string
          p_request_id: string
        }
        Returns: Json
      }
      real_admin_reissue_staff_invitation: {
        Args: {
          p_expected_generation: number
          p_invitation_id: string
          p_request_id: string
        }
        Returns: Json
      }
      real_admin_remove_staff: {
        Args: {
          p_expected_version: string
          p_request_id: string
          p_staff_id: string
        }
        Returns: Json
      }
      real_admin_request_staff_recovery: {
        Args: {
          p_expected_version: string
          p_request_id: string
          p_staff_id: string
        }
        Returns: Json
      }
      real_admin_reserve_doctor_invitation: {
        Args: {
          p_clinic_id: string
          p_display_name: string
          p_email: string
          p_request_id: string
        }
        Returns: Json
      }
      real_admin_reserve_staff_invitation: {
        Args: {
          p_clinic_id: string
          p_display_name: string
          p_email: string
          p_request_id: string
          p_role: string
        }
        Returns: Json
      }
      real_admin_scheduling_copy_settings: { Args: never; Returns: Json }
      real_admin_staff: { Args: never; Returns: Json }
      real_admin_staff_recovery_summaries: { Args: never; Returns: Json }
      real_admin_update_clinic_scheduling_email: {
        Args: {
          p_clinic_id: string
          p_email?: string
          p_expected_revision: number
          p_request_id: string
        }
        Returns: Json
      }
      real_admin_update_scheduling_copy_email: {
        Args: {
          p_email?: string
          p_expected_revision: number
          p_request_id: string
        }
        Returns: Json
      }
      real_admin_update_staff: {
        Args: {
          p_clinic_id: string
          p_display_name: string
          p_expected_version: string
          p_request_id: string
          p_staff_id: string
        }
        Returns: Json
      }
      real_clinical_staff_identity: { Args: never; Returns: Json }
      real_staff_bind_invitation_identity: {
        Args: {
          p_auth_user_id: string
          p_generation: number
          p_invitation_id: string
          p_operation_id: string
        }
        Returns: Json
      }
      real_staff_claim_invitation_dispatch: {
        Args: {
          p_generation: number
          p_invitation_id: string
          p_operation_id: string
        }
        Returns: Json
      }
      real_staff_clinical_session_allowed: { Args: never; Returns: boolean }
      real_staff_finalize_doctor_invitation: {
        Args: {
          p_auth_session_id: string
          p_auth_user_id: string
          p_generation: number
          p_invitation_id: string
        }
        Returns: Json
      }
      real_staff_finalize_invitation: {
        Args: {
          p_auth_session_id: string
          p_auth_user_id: string
          p_generation: number
          p_invitation_id: string
        }
        Returns: Json
      }
      real_staff_invitation_context: {
        Args: { p_generation: number; p_invitation_id: string }
        Returns: Json
      }
      real_staff_onboarding_session: { Args: never; Returns: boolean }
      real_staff_record_invitation_submission: {
        Args: {
          p_generation: number
          p_invitation_id: string
          p_operation_id: string
          p_outcome: string
          p_provider_reference?: string
        }
        Returns: Json
      }
      real_staff_record_invitation_verification: {
        Args: {
          p_auth_user_id: string
          p_generation: number
          p_invitation_id: string
        }
        Returns: Json
      }
      real_staff_recovery_context: {
        Args: { p_generation: number; p_id: string; p_session?: string }
        Returns: Json
      }
      real_staff_recovery_step: {
        Args: {
          p_digest?: string
          p_generation: number
          p_id: string
          p_reference?: string
          p_session?: string
          p_step: string
        }
        Returns: Json
      }
      real_staff_store_invitation_token: {
        Args: {
          p_generation: number
          p_invitation_id: string
          p_operation_id: string
          p_token_digest: string
          p_token_type: string
        }
        Returns: Json
      }
      reconcile_booking_notice: {
        Args: {
          p_actor: string
          p_appointment: string
          p_command: string
          p_engine: string
          p_member: string
          p_notice: string
          p_revision: number
          p_sender: string
          p_template: string
        }
        Returns: Json
      }
      record_booking_notice_receipt: {
        Args: {
          p_accepted_roles?: Json
          p_attempt: string
          p_generation: number
          p_hash: string
          p_notice: string
          p_outcome: string
          p_reference?: string
        }
        Returns: boolean
      }
      record_patient_measurement: {
        Args: {
          p_diastolic: number
          p_measured_at: string
          p_pulse: number
          p_submission_id: string
          p_systolic: number
        }
        Returns: string
      }
      record_patient_measurement_sourced: {
        Args: {
          p_diastolic: number
          p_entry_source: string
          p_measured_at: string
          p_pulse: number
          p_submission_id: string
          p_systolic: number
        }
        Returns: string
      }
      record_patient_message_delivery: {
        Args: {
          p_attempt_id: string
          p_error_code?: string
          p_reference: string
          p_status: string
        }
        Returns: boolean
      }
      recover_booking_command: {
        Args: {
          p_actor: string
          p_command: string
          p_member: string
          p_selection: Json
        }
        Returns: Json
      }
      recover_failed_auth_verify_recipient: {
        Args: { p_expected_webhook_id: string; p_operator_label: string }
        Returns: boolean
      }
      register_booking_program: {
        Args: {
          p_actor: string
          p_id: string
          p_member: string
          p_program: Json
        }
        Returns: Json
      }
      register_manual_booking_offer: {
        Args: {
          p_actor: string
          p_capacity: number
          p_offer: Json
          p_valid_until: string
        }
        Returns: Json
      }
      report_patient_dose: {
        Args: { p_due_at: string; p_medication_id: string; p_status: string }
        Returns: undefined
      }
      report_patient_dose_for: {
        Args: {
          p_due_at: string
          p_expected_revision: number
          p_medication_id: string
          p_member: string
          p_status: string
        }
        Returns: Json
      }
      report_patient_dose_unversioned: {
        Args: { p_due_at: string; p_medication_id: string; p_status: string }
        Returns: undefined
      }
      report_patient_dose_versioned: {
        Args: {
          p_due_at: string
          p_expected_revision: number
          p_medication_id: string
          p_status: string
        }
        Returns: number
      }
      reserve_report_upload: {
        Args: {
          p_consent: string
          p_mime: string
          p_name: string
          p_owner: string
          p_size: number
        }
        Returns: string
      }
      resume_patient_message_dispatch: {
        Args: {
          p_acknowledgement: string
          p_daily_limit?: number
          p_expected_revision: number
          p_operator_label?: string
        }
        Returns: boolean
      }
      resume_patient_message_dispatch_unattributed: {
        Args: {
          p_acknowledgement: string
          p_daily_limit?: number
          p_expected_revision: number
        }
        Returns: boolean
      }
      retry_booking_notice: {
        Args: {
          p_actor: string
          p_appointment: string
          p_command: string
          p_engine: string
          p_member: string
          p_notice: string
          p_revision: number
          p_sender: string
          p_template: string
        }
        Returns: Json
      }
      retry_patient_message_submission: {
        Args: { p_attempt_id: string; p_operator_label: string }
        Returns: boolean
      }
      save_member_preferences: {
        Args: {
          p_contact_channel?: string
          p_contact_times?: string[]
          p_text_size?: string
        }
        Returns: Json
      }
      save_patient_assessment: {
        Args: {
          p_answers: Json
          p_complete: boolean
          p_expected_revision: number
          p_urgent_rule: string
          p_user_id: string
        }
        Returns: number
      }
      save_patient_assessment_sourced: {
        Args: {
          p_answers: Json
          p_complete: boolean
          p_expected_revision: number
          p_sources: Json
          p_urgent_rule: string
          p_user_id: string
        }
        Returns: number
      }
      save_patient_clinical_draft: {
        Args: {
          p_draft: Json
          p_evidence_token: string
          p_expected_revision: number
          p_user_id: string
        }
        Returns: number
      }
      save_patient_clinical_draft_before_review: {
        Args: {
          p_draft: Json
          p_evidence_token: string
          p_expected_revision: number
          p_user_id: string
        }
        Returns: number
      }
      save_patient_clinical_draft_from_ai: {
        Args: {
          p_draft: Json
          p_evidence_token: string
          p_expected_revision: number
          p_generation: string
          p_user_id: string
        }
        Returns: number
      }
      save_patient_locale: {
        Args: {
          p_expected_locale: string
          p_expected_revision: number
          p_locale: string
        }
        Returns: number
      }
      save_patient_message_preferences: {
        Args: {
          p_channel: string
          p_consent_version: string
          p_expected_revision: number
        }
        Returns: number
      }
      save_patient_message_preferences_for_phone: {
        Args: {
          p_channel: string
          p_consent_version: string
          p_expected_phone: string
          p_expected_revision: number
        }
        Returns: number
      }
      save_patient_profile: {
        Args: {
          p_answers: Json
          p_birth_date: string
          p_consent_version: string
          p_expected_revision: number
          p_locale: string
          p_name: string
          p_sex: string
          p_urgent_rule: string
          p_user_id: string
        }
        Returns: number
      }
      save_patient_reminder_preferences: {
        Args: { p_expected_revision: number; p_preferences: Json }
        Returns: number
      }
      select_booking_appointment: {
        Args: {
          p_actor: string
          p_agreement_source?: string
          p_appointment_id?: string
          p_command_id: string
          p_home_address?: string
          p_legacy_id?: string
          p_member: string
          p_offer_id: string
          p_offer_version: string
          p_program_id: string
          p_revision?: number
          p_sender_email?: string
          p_subject?: string
          p_template_version?: string
          p_text_content?: string
        }
        Returns: Json
      }
      staff_callback_close: {
        Args: { p_outcome: string; p_request: string }
        Returns: Json
      }
      staff_callback_queue: { Args: never; Returns: Json }
      staff_care_access: {
        Args: { p_actor: string; p_id: string; p_native: boolean }
        Returns: boolean
      }
      staff_care_command: {
        Args: {
          p_actor: string
          p_id: string
          p_input: Json
          p_native: boolean
          p_operation: string
          p_revision: number
        }
        Returns: number
      }
      staff_chat_member_identities: {
        Args: { p_members: string[] }
        Returns: Json
      }
      staff_clinic_change_decide: {
        Args: { p_decision: string; p_note?: string; p_request: string }
        Returns: Json
      }
      staff_clinic_change_requests: {
        Args: { p_state?: string }
        Returns: Json
      }
      staff_invitation_telegram_issue: {
        Args: {
          p_generation: number
          p_invitation_id: string
          p_operation_id: string
          p_phone: string
        }
        Returns: Json
      }
      staff_invite_admit: {
        Args: {
          p_claim: string
          p_nonce_hmac: string
          p_session: string
          p_user: string
        }
        Returns: Json
      }
      staff_invite_code_begin: {
        Args: {
          p_code_hmac: string
          p_generation: number
          p_invitation_id: string
          p_nonce_hmac: string
          p_start_token_hash: string
        }
        Returns: Json
      }
      staff_invite_code_verify: {
        Args: {
          p_challenge: string
          p_code_hmac: string
          p_generation: number
          p_invitation_id: string
          p_nonce_hmac: string
        }
        Returns: Json
      }
      staff_invite_reject_session: {
        Args: { p_claim: string; p_session: string }
        Returns: Json
      }
      staff_lab_ai_results: { Args: { p_user_id: string }; Returns: Json }
      staff_member_history: { Args: { p_member: string }; Returns: Json }
      staff_member_history_document: {
        Args: { p_document: string; p_member: string }
        Returns: Json
      }
      staff_member_identities: { Args: { p_members: string[] }; Returns: Json }
      staff_member_safety: { Args: { p_member: string }; Returns: Json }
      staff_member_safety_decide: {
        Args: { p_action: string; p_hold: string; p_note?: string }
        Returns: Json
      }
      staff_member_upload_approvals: {
        Args: { p_user_id: string }
        Returns: Json
      }
      staff_member_upload_overrides: {
        Args: { p_member: string }
        Returns: Json
      }
      staff_notice_issue: {
        Args: { p_alert?: string; p_member: string; p_recipient: string }
        Returns: string
      }
      staff_notice_resolve: {
        Args: { p_token: string }
        Returns: {
          alert_id: string
          member_id: string
        }[]
      }
      staff_patient_test_command: {
        Args: {
          p_command_id: string
          p_id: string
          p_input: Json
          p_operation: string
          p_revision: number
        }
        Returns: Json
      }
      staff_record_member_access: {
        Args: { p_member: string; p_object?: string; p_surface: string }
        Returns: undefined
      }
      staff_recovery_code_begin: {
        Args: {
          p_code_hmac: string
          p_nonce_hmac: string
          p_recovery: string
          p_token_hash: string
        }
        Returns: Json
      }
      staff_recovery_code_verify: {
        Args: {
          p_challenge: string
          p_code_hmac: string
          p_nonce_hmac: string
          p_recovery: string
        }
        Returns: Json
      }
      staff_recovery_finish: {
        Args: { p_nonce_hmac: string; p_recovery: string }
        Returns: Json
      }
      staff_recovery_link: { Args: { p_recovery: string }; Returns: Json }
      staff_signin_code_begin: {
        Args: {
          p_code_hmac: string
          p_nonce_hmac: string
          p_session: string
          p_user: string
        }
        Returns: Json
      }
      staff_signin_code_verify: {
        Args: {
          p_challenge: string
          p_code_hmac: string
          p_nonce_hmac: string
          p_session: string
          p_user: string
        }
        Returns: Json
      }
      staff_signin_state: { Args: never; Returns: Json }
      staff_telegram_enrolment_issue: {
        Args: { p_phone: string; p_replace?: boolean; p_staff: string }
        Returns: Json
      }
      staff_telegram_recovery_issue: {
        Args: { p_portal: string; p_user: string }
        Returns: Json
      }
      staff_telegram_revoke: { Args: { p_staff: string }; Returns: Json }
      staff_telegram_status: { Args: { p_staff: string }; Returns: Json }
      staff_test_account_flags: { Args: { p_ids: string[] }; Returns: string[] }
      staff_zoe_begin: {
        Args: { p_conversation: string; p_submission: string; p_text: string }
        Returns: Json
      }
      staff_zoe_candidates: { Args: { p_query: string }; Returns: Json }
      staff_zoe_finish: {
        Args: { p_result: Json; p_run: string }
        Returns: Json
      }
      staff_zoe_gate: { Args: { p_run: string; p_tool: string }; Returns: Json }
      staff_zoe_member_conversation: {
        Args: { p_member: string }
        Returns: string
      }
      staff_zoe_open: { Args: { p_member: string }; Returns: Json }
      staff_zoe_read: { Args: { p_conversation: string }; Returns: Json }
      staff_zoe_recent: { Args: never; Returns: Json }
      staff_zoe_reserve: {
        Args: {
          p_estimate_usd: number
          p_local: boolean
          p_model: string
          p_run: string
          p_tier: string
        }
        Returns: Json
      }
      staff_zoe_status: { Args: never; Returns: boolean }
      start_booking_notice: {
        Args: {
          p_actor: string
          p_appointment: string
          p_command: string
          p_engine: string
          p_member: string
          p_notice: string
          p_revision: number
          p_sender: string
          p_template: string
        }
        Returns: Json
      }
      system_message_claim: {
        Args: { p_attempt: string; p_message: string }
        Returns: Json
      }
      system_message_outcome: {
        Args: { p_attempt: string; p_outcome: Json }
        Returns: Json
      }
      telegram_auth_challenge_create: {
        Args: {
          p_allow_replace?: boolean
          p_consent_version?: string
          p_nonce_hmac?: string
          p_phone: string
          p_purpose: string
          p_user?: string
        }
        Returns: Json
      }
      telegram_auth_message_claim: {
        Args: { p_attempt: string; p_message: string }
        Returns: Json
      }
      telegram_auth_message_outcome: {
        Args: { p_attempt: string; p_outcome: Json }
        Returns: Json
      }
      telegram_auth_message_queue: { Args: { p_limit: number }; Returns: Json }
      telegram_auth_unlink: { Args: never; Returns: Json }
      telegram_delivery_problems: { Args: never; Returns: Json }
      telegram_dispatch_queue: { Args: { p_limit: number }; Returns: Json }
      telegram_link_status: { Args: never; Returns: Json }
      telegram_nurse_apply: {
        Args: { p_attempt: number; p_enabled: boolean; p_id: string }
        Returns: Json
      }
      telegram_nurse_outbox_claim: {
        Args: { p_enabled: boolean; p_id: string }
        Returns: Json
      }
      telegram_nurse_outbox_outcome: {
        Args: {
          p_attempt: string
          p_enabled: boolean
          p_id: string
          p_result: Json
        }
        Returns: Json
      }
      telegram_nurse_outbox_queue: {
        Args: { p_enabled: boolean; p_limit?: number }
        Returns: Json
      }
      telegram_nurse_outbox_reconcile: {
        Args: { p_enabled: boolean }
        Returns: Json
      }
      telegram_nurse_receive: {
        Args: { p_enabled: boolean; p_id: string }
        Returns: Json
      }
      telegram_nurse_resume: {
        Args: { p_attempt: number; p_enabled: boolean; p_id: string }
        Returns: Json
      }
      telegram_nurse_visit_prepare: {
        Args: {
          p_attempt: number
          p_enabled: boolean
          p_id: string
          p_plan: Json
        }
        Returns: Json
      }
      telegram_nurse_visit_render: {
        Args: {
          p_attempt: number
          p_enabled: boolean
          p_id: string
          p_plan: Json
        }
        Returns: Json
      }
      telegram_replies_auto_link: {
        Args: { p_explicit?: boolean }
        Returns: Json
      }
      telegram_replies_auto_link_for: {
        Args: { p_user: string }
        Returns: Json
      }
      telegram_signin_link_arm: {
        Args: { p_message: string; p_token_hash: string }
        Returns: Json
      }
      telegram_signin_link_arm_reply: {
        Args: { p_kind: string; p_ref: string; p_token_hash: string }
        Returns: Json
      }
      telegram_signin_link_begin: {
        Args: {
          p_current_user: string
          p_nonce_hmac: string
          p_switch: boolean
          p_token_hash: string
        }
        Returns: Json
      }
      telegram_signin_link_code: {
        Args: { p_nonce_hmac: string; p_request: string }
        Returns: Json
      }
      telegram_signin_link_finish: {
        Args: { p_nonce_hmac: string; p_request: string }
        Returns: Json
      }
      telegram_signin_links_cancel: { Args: { p_user: string }; Returns: Json }
      telegram_unlink: { Args: never; Returns: Json }
      test_account_operator_identity: { Args: never; Returns: Json }
      test_account_reset_begin: {
        Args: { p_member: string; p_request_key: string }
        Returns: Json
      }
      test_account_reset_claim: { Args: { p_reset: string }; Returns: Json }
      test_account_reset_finish: {
        Args: { p_claim: string; p_ok: boolean; p_reset: string }
        Returns: Json
      }
      test_accounts_list: { Args: never; Returns: Json }
      test_signin_admin_add: {
        Args: { p_days?: number; p_label: string; p_phone: string }
        Returns: Json
      }
      test_signin_admin_list: { Args: never; Returns: Json }
      test_signin_admin_remove: { Args: { p_id: string }; Returns: Json }
      test_signin_admin_set_code: { Args: { p_id: string }; Returns: Json }
      test_signin_admin_switch: { Args: { p_enabled: boolean }; Returns: Json }
      test_signin_check: {
        Args: {
          p_code_digest: string
          p_env_enabled: boolean
          p_nonce_hmac: string
          p_request: string
          p_test_code: string
        }
        Returns: Json
      }
      test_signin_claim: {
        Args: {
          p_body_hmac: string
          p_env_enabled: boolean
          p_phone: string
          p_webhook_id: string
        }
        Returns: Json
      }
      test_signin_direct_abandon: {
        Args: {
          p_env_enabled: boolean
          p_nonce_hmac: string
          p_phone: string
          p_request: string
        }
        Returns: Json
      }
      test_signin_direct_begin: {
        Args: { p_env_enabled: boolean; p_nonce_hmac: string; p_phone: string }
        Returns: Json
      }
      test_signin_direct_check: {
        Args: {
          p_env_enabled: boolean
          p_nonce_hmac: string
          p_phone: string
          p_request: string
          p_test_code: string
        }
        Returns: Json
      }
      test_signin_direct_verified: {
        Args: {
          p_code_digest: string
          p_env_enabled: boolean
          p_nonce_hmac: string
          p_phone: string
          p_request: string
          p_session: string
          p_user: string
        }
        Returns: Json
      }
      test_signin_verified: {
        Args: {
          p_code_digest: string
          p_env_enabled: boolean
          p_nonce_hmac: string
          p_request: string
          p_session: string
          p_user: string
        }
        Returns: Json
      }
      valid_care_times: {
        Args: { values_to_check: string[] }
        Returns: boolean
      }
      valid_patient_provider_source: {
        Args: { p_input: Json }
        Returns: boolean
      }
      valid_patient_test_preference: {
        Args: { p_terms: Json }
        Returns: boolean
      }
      valid_patient_test_terms: { Args: { p_terms: Json }; Returns: boolean }
      workspace_accept_reading: {
        Args: {
          p_diastolic: number
          p_id: string
          p_measured_at: string
          p_pulse?: number
          p_submission: string
          p_systolic: number
        }
        Returns: string
      }
      workspace_acknowledge_monitoring: {
        Args: { p_id: string; p_requirement: string }
        Returns: undefined
      }
      workspace_acknowledge_plan: {
        Args: { p_expected_revision: number; p_id: string; p_plan_id: string }
        Returns: number
      }
      workspace_assign_case: {
        Args: { p_doctor_id: string; p_expected_revision: number; p_id: string }
        Returns: number
      }
      workspace_assign_case_audited: {
        Args: {
          p_actor: string
          p_doctor_id: string
          p_expected_revision: number
          p_id: string
        }
        Returns: number
      }
      workspace_associate_report: {
        Args: {
          p_actor: string
          p_expected_evidence: number
          p_expected_report_revision: number
          p_id: string
          p_report_id: string
          p_requirement_id: string
          p_rows: number[]
        }
        Returns: number
      }
      workspace_cancel_monitoring: {
        Args: {
          p_actor: string
          p_expected_revision: number
          p_id: string
          p_note: string
          p_requirement: string
        }
        Returns: number
      }
      workspace_care_continuity: {
        Args: { c: Json; prior: Json }
        Returns: Json
      }
      workspace_case_snapshot: { Args: { p_id: string }; Returns: Json }
      workspace_clinical_context: { Args: { s: Json }; Returns: Json }
      workspace_complete_review_no_change: {
        Args: {
          p_actor: string
          p_expected_evidence_revision: number
          p_expected_revision: number
          p_id: string
          p_note: string
          p_task_id: string
        }
        Returns: number
      }
      workspace_create_case: {
        Args: { p_doctor?: string; p_id: string; p_state: Json }
        Returns: number
      }
      workspace_create_case_admitted: {
        Args: {
          p_doctor?: string
          p_id: string
          p_source: string
          p_state: Json
        }
        Returns: number
      }
      workspace_create_monitoring: {
        Args: {
          p_actor: string
          p_count: number
          p_end: string
          p_expected_evidence: number
          p_expected_revision: number
          p_id: string
          p_instructions: string
          p_request_id: string
          p_start: string
        }
        Returns: string
      }
      workspace_delete_expired_case: {
        Args: { p_id: string }
        Returns: boolean
      }
      workspace_due_monitoring_cases: {
        Args: { p_actor?: string; p_excluded?: string[]; p_limit?: number }
        Returns: string[]
      }
      workspace_evidence_projection: { Args: { s: Json }; Returns: Json }
      workspace_finish_review_task: {
        Args: {
          p_actor: string
          p_expected_evidence_revision: number
          p_id: string
          p_note: string
          p_outcome: string
          p_task_id: string
        }
        Returns: number
      }
      workspace_followup_contact: {
        Args: {
          p_actor: string
          p_expected_revision: number
          p_id: string
          p_note: string
          p_outcome: string
          p_requirement: string
        }
        Returns: number
      }
      workspace_initialize_workflow: {
        Args: { p_expected_revision: number; p_id: string; p_workflow: Json }
        Returns: number
      }
      workspace_js_trim: { Args: { s: string }; Returns: string }
      workspace_medication_fields: { Args: { d: Json }; Returns: Json }
      workspace_monitoring_snapshot: { Args: { p_id: string }; Returns: Json }
      workspace_publication_continuity: {
        Args: { p: Json; w: Json }
        Returns: Json
      }
      workspace_publication_order: { Args: { w: Json }; Returns: Json }
      workspace_publish_review: {
        Args: {
          p_actor: string
          p_expected_evidence_revision: number
          p_expected_revision: number
          p_id: string
        }
        Returns: number
      }
      workspace_publish_review_before_monitoring: {
        Args: {
          p_actor: string
          p_expected_evidence_revision: number
          p_expected_revision: number
          p_id: string
        }
        Returns: number
      }
      workspace_reconcile_monitoring: {
        Args: { p_id: string }
        Returns: number
      }
      workspace_reconcile_review_task: {
        Args: { p_id: string; p_opens: boolean; p_reason: string }
        Returns: string
      }
      workspace_record_event: {
        Args: { p_case: string; p_kind: string; p_revision: number }
        Returns: undefined
      }
      workspace_report_content_transition: {
        Args: { p_at: string; p_new: Json; p_old: Json }
        Returns: Json
      }
      workspace_report_dose: {
        Args: {
          p_due_at: string
          p_expected_revision: number
          p_id: string
          p_order_id: string
          p_plan_id: string
          p_status: string
        }
        Returns: number
      }
      workspace_report_dose_versioned: {
        Args: {
          p_due_at: string
          p_expected_dose_revision: number
          p_expected_revision: number
          p_id: string
          p_order_id: string
          p_plan_id: string
          p_status: string
        }
        Returns: number
      }
      workspace_reset_review: {
        Args: {
          p_actor: string
          p_expected_revision: number
          p_id: string
          p_workflow: Json
        }
        Returns: number
      }
      workspace_reset_review_before_monitoring: {
        Args: {
          p_actor: string
          p_expected_revision: number
          p_id: string
          p_workflow: Json
        }
        Returns: number
      }
      workspace_review_coverage: { Args: { p_id: string }; Returns: Json }
      workspace_review_doctor: {
        Args: { p_actor: string; p_id: string }
        Returns: string
      }
      workspace_save_case: {
        Args: {
          p_expected_revision: number
          p_id: string
          p_publication_key?: string
          p_state: Json
        }
        Returns: number
      }
      workspace_save_case_audited: {
        Args: {
          p_actor?: string
          p_expected_revision: number
          p_id: string
          p_publication_key?: string
          p_state: Json
        }
        Returns: number
      }
      workspace_save_case_before_monitoring: {
        Args: {
          p_expected_revision: number
          p_id: string
          p_publication_key?: string
          p_state: Json
        }
        Returns: number
      }
      workspace_save_member_locale: {
        Args: {
          p_assessment_revision: number
          p_expected_locale: string
          p_expected_revision: number
          p_id: string
          p_locale: string
        }
        Returns: number
      }
      workspace_save_review_draft: {
        Args: {
          p_actor: string
          p_draft: Json
          p_expected_evidence_revision: number
          p_expected_revision: number
          p_id: string
          p_monitoring_decisions?: Json
        }
        Returns: number
      }
      workspace_save_review_draft_before_monitoring: {
        Args: {
          p_actor: string
          p_draft: Json
          p_expected_evidence_revision: number
          p_expected_revision: number
          p_id: string
        }
        Returns: number
      }
      workspace_set_actor: {
        Args: { p_actor: string; p_case: string }
        Returns: undefined
      }
      workspace_text_units: { Args: { s: string }; Returns: number }
      workspace_valid_review_draft: { Args: { d: Json }; Returns: boolean }
      workspace_write_report: {
        Args: {
          p_actor?: string
          p_approval?: Json
          p_expected_revision?: number
          p_id: string
          p_op: string
          p_record?: Json
          p_report_id: string
        }
        Returns: number
      }
      zoe_ai_settings_admin: { Args: never; Returns: Json }
      zoe_bp_delivery_record: {
        Args: { p_card: string; p_member: string; p_request: string }
        Returns: Json
      }
      zoe_bp_episode: {
        Args: { p_member: string; p_minutes: number; p_submission: string }
        Returns: Json
      }
      zoe_bp_merge_retry: { Args: { p_limit: number }; Returns: Json }
      zoe_bp_messages_pending: {
        Args: { p_limit: number; p_member: string }
        Returns: Json
      }
      zoe_bp_open_emergencies: { Args: never; Returns: Json }
      zoe_bp_reading_zone: {
        Args: {
          p_member: string
          p_reading: string
          p_rule_version: string
          p_zone: string
        }
        Returns: Json
      }
      zoe_bp_staff_item: {
        Args: {
          p_episode: string
          p_member: string
          p_minutes: number
          p_reading: string
          p_submission: string
        }
        Returns: Json
      }
      zoe_bp_task_raise: {
        Args: {
          p_action: string
          p_episode: string
          p_member: string
          p_minutes: number
          p_queue: string
          p_reading: string
          p_reason: string
          p_red_flags: string
          p_rule_version: string
          p_sla: string
          p_source_ref: string
          p_submission: string
          p_summary: Json
          p_zone: string
        }
        Returns: Json
      }
      zoe_chat_action_trace: {
        Args: {
          p_attributes: Json
          p_member: string
          p_name: string
          p_outcome: string
          p_reason: string
          p_rule: string
          p_rule_version: string
        }
        Returns: Json
      }
      zoe_chat_card_arm: {
        Args: {
          p_buttons: Json
          p_card: string
          p_endpoint: string
          p_generation: number
          p_member: string
        }
        Returns: Json
      }
      zoe_chat_card_claim: {
        Args: {
          p_card: string
          p_item: string
          p_member: string
          p_op: string
          p_payload: Json
        }
        Returns: Json
      }
      zoe_chat_card_for_message: { Args: { p_message: string }; Returns: Json }
      zoe_chat_card_get: {
        Args: { p_card: string; p_member: string }
        Returns: Json
      }
      zoe_chat_card_notice: { Args: { p_message: string }; Returns: Json }
      zoe_chat_card_post: {
        Args: {
          p_kind: string
          p_member: string
          p_request: string
          p_snapshot: Json
          p_source: string
          p_source_seq: number
        }
        Returns: Json
      }
      zoe_chat_card_record: {
        Args: {
          p_card: string
          p_close: boolean
          p_item: string
          p_member: string
          p_value: Json
        }
        Returns: Json
      }
      zoe_chat_card_release: {
        Args: { p_attempt: string; p_card: string; p_member: string }
        Returns: Json
      }
      zoe_chat_card_send: {
        Args: {
          p_body: string
          p_card: string
          p_inbox: string
          p_member: string
        }
        Returns: Json
      }
      zoe_chat_card_telegram_candidates: {
        Args: { p_limit: number }
        Returns: Json
      }
      zoe_chat_card_telegram_settle: {
        Args: { p_member: string; p_seq: number }
        Returns: undefined
      }
      zoe_chat_card_unclaim: {
        Args: { p_card: string; p_item: string; p_member: string; p_op: string }
        Returns: Json
      }
      zoe_chat_cards_member: { Args: never; Returns: Json }
      zoe_coach_blocked: { Args: { m: string }; Returns: boolean }
      zoe_coach_claim: { Args: { p_limit: number }; Returns: Json }
      zoe_coach_consent_set: {
        Args: {
          p_granted: boolean
          p_kind: string
          p_source: string
          p_wording_version: string
        }
        Returns: Json
      }
      zoe_coach_finish: {
        Args: { p_result: Json; p_run: string }
        Returns: Json
      }
      zoe_coach_member_status: { Args: never; Returns: Json }
      zoe_coach_pause: { Args: { p_paused: boolean }; Returns: Json }
      zoe_coach_queue_teaser: { Args: { p_event: string }; Returns: Json }
      zoe_coach_reserve: {
        Args: {
          p_estimate_usd: number
          p_events: Json
          p_judge_model?: string
          p_local: boolean
          p_model: string
          p_run: string
          p_tier: string
        }
        Returns: Json
      }
      zoe_coach_schedule: {
        Args: { p_due_at: string; p_kind: string; p_member: string }
        Returns: Json
      }
      zoe_consent_accept_shown: {
        Args: { p_text_hash: string; p_wording_version: string }
        Returns: Json
      }
      zoe_consent_prompt: { Args: never; Returns: Json }
      zoe_consent_set:
        | {
            Args: {
              p_granted: boolean
              p_kind: string
              p_wording_version: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_granted: boolean
              p_kind: string
              p_source: string
              p_wording_version: string
            }
            Returns: Json
          }
      zoe_consent_status: { Args: never; Returns: Json }
      zoe_eval_run_record: {
        Args: {
          p_admin: string
          p_failed_ids: string[]
          p_failures: number
          p_fallback: string
          p_harness_version: string
          p_mode: string
          p_model: string
          p_must_failures: number
          p_tier: string
          p_total: number
        }
        Returns: Json
      }
      zoe_held_ack_release: { Args: never; Returns: Json }
      zoe_living_visit_sync: { Args: { p_member: string }; Returns: Json }
      zoe_member_clinic_hours: { Args: { p_member: string }; Returns: Json }
      zoe_model_eval_finish: {
        Args: { p_error_code: string; p_eval_run: string; p_job: string }
        Returns: Json
      }
      zoe_model_eval_job_admin: { Args: never; Returns: Json }
      zoe_model_eval_start: {
        Args: { p_admin: string; p_model: string; p_tier: string }
        Returns: Json
      }
      zoe_practice_mutate: {
        Args: { p_author: string; p_input: Json; p_operation: string }
        Returns: Json
      }
      zoe_reply_drafts_for_doctor: { Args: { p_member: string }; Returns: Json }
      zoe_route_config: { Args: never; Returns: Json }
      zoe_run_alarm_window: { Args: { p_runs: string[] }; Returns: Json }
      zoe_run_bp_typed_save: {
        Args: {
          p_diastolic: number
          p_index: number
          p_message_seq: number
          p_run: string
          p_systolic: number
        }
        Returns: Json
      }
      zoe_run_claim: { Args: { p_limit: number }; Returns: Json }
      zoe_run_classifier_authorized: {
        Args: { p_model?: string; p_run: string }
        Returns: Json
      }
      zoe_run_context: { Args: { p_runs: string[] }; Returns: Json }
      zoe_run_detail: { Args: { p_run: string }; Returns: Json }
      zoe_run_doctor_mode: { Args: { p_runs: string[] }; Returns: Json }
      zoe_run_finish: { Args: { p_result: Json; p_run: string }; Returns: Json }
      zoe_run_health_context: { Args: { p_runs: string[] }; Returns: Json }
      zoe_run_medicines_add: {
        Args: { p_medicines: Json; p_run: string }
        Returns: Json
      }
      zoe_run_member_record: { Args: { p_runs: string[] }; Returns: Json }
      zoe_run_member_statements: {
        Args: { p_run: string; p_statements: Json }
        Returns: Json
      }
      zoe_run_plan: { Args: { p_runs: string[] }; Returns: Json }
      zoe_run_record_reply_draft: {
        Args: { p_record: Json; p_run: string }
        Returns: Json
      }
      zoe_run_reserve: {
        Args: {
          p_estimate_usd: number
          p_events: Json
          p_judge_model?: string
          p_local: boolean
          p_model: string
          p_run: string
          p_tier: string
        }
        Returns: Json
      }
      zoe_run_resumable: { Args: { p_runs: string[] }; Returns: Json }
      zoe_run_topic: { Args: { p_runs: string[] }; Returns: Json }
      zoe_run_urgent_window: { Args: { p_runs: string[] }; Returns: Json }
      zoe_run_why: { Args: { p_run: string }; Returns: Json }
      zoe_run_why_record: {
        Args: { p_run: string; p_why: Json }
        Returns: Json
      }
      zoe_runs_for_doctor: { Args: { p_member: string }; Returns: Json }
      zoe_runs_for_doctor_unlogged: {
        Args: { p_member: string }
        Returns: Json
      }
      zoe_symptom_intake_member: { Args: never; Returns: Json }
      zoe_symptom_intakes_for_doctor: {
        Args: { p_member: string }
        Returns: Json
      }
      zoe_tier_config_apply: {
        Args: {
          p_daily_cap_usd: number
          p_eval: string
          p_expected_version: number
          p_reason: string
        }
        Returns: Json
      }
      zoe_tier_config_rollback: {
        Args: { p_change: number; p_expected_version: number; p_reason: string }
        Returns: Json
      }
      zoe_unread_urgent_finish: {
        Args: { p_result: Json; p_run: string }
        Returns: Json
      }
      zoe_unread_urgent_pending: { Args: { p_limit: number }; Returns: Json }
      zoe_v3_adherence_context: { Args: { p_member: string }; Returns: Json }
      zoe_v3_consult_questions_save: {
        Args: { p_appointment: string; p_groups: Json; p_request: string }
        Returns: boolean
      }
      zoe_v3_consult_questions_sent: {
        Args: { p_request: string }
        Returns: boolean
      }
      zoe_v3_document_details: {
        Args: { p_document: string; p_study_date: string; p_type: string }
        Returns: boolean
      }
      zoe_v3_document_read: { Args: { p_document?: string }; Returns: Json }
      zoe_v3_dose_reason: {
        Args: {
          p_card: string
          p_later: boolean
          p_member: string
          p_op: string
          p_reason: string
        }
        Returns: Json
      }
      zoe_v3_dose_record: {
        Args: {
          p_card: string
          p_due: string
          p_medicine: string
          p_member: string
          p_op: string
          p_status: string
        }
        Returns: Json
      }
      zoe_v3_lab_appointment: { Args: { p_appointment: string }; Returns: Json }
      zoe_v3_lab_candidates: {
        Args: { p_after?: string; p_after_id?: string; p_limit?: number }
        Returns: Json
      }
      zoe_v3_lab_card_post: {
        Args: {
          p_appointment: string
          p_kind: string
          p_request: string
          p_revision: number
        }
        Returns: Json
      }
      zoe_v3_lab_changes: { Args: never; Returns: Json }
      zoe_v3_medicines_save: { Args: { p_card: string }; Returns: Json }
      zoe_v3_next_step_follow: {
        Args: {
          p_card: string
          p_member: string
          p_request: string
          p_snapshot: Json
          p_target: string
        }
        Returns: Json
      }
      zoe_v3_next_step_follow_living: {
        Args: {
          p_card: string
          p_member: string
          p_request: string
          p_snapshot: Json
          p_target: string
        }
        Returns: Json
      }
      zoe_v3_next_step_sync: {
        Args: {
          p_member: string
          p_previous: string
          p_request: string
          p_seen: string
          p_snapshot: Json
        }
        Returns: Json
      }
      zoe_v3_plan_confirm: {
        Args: { p_card: string; p_member: string; p_op: string }
        Returns: Json
      }
      zoe_v3_plan_members: { Args: never; Returns: Json }
      zoe_v3_plan_state: { Args: never; Returns: Json }
      zoe_v3_reminders_run: { Args: { p_now?: string }; Returns: Json }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

