export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ap_bank_balance: {
        Row: {
          amount: number
          balance_date: string
          bank_name: string
          created_at: string
          hotel_id: string
          id: string
          informed_by: string
          updated_at: string
        }
        Insert: {
          amount: number
          balance_date: string
          bank_name?: string
          created_at?: string
          hotel_id: string
          id?: string
          informed_by: string
          updated_at?: string
        }
        Update: {
          amount?: number
          balance_date?: string
          bank_name?: string
          created_at?: string
          hotel_id?: string
          id?: string
          informed_by?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ap_bank_balance_hotel_id_fkey"
            columns: ["hotel_id"]
            isOneToOne: false
            referencedRelation: "hotels"
            referencedColumns: ["id"]
          },
        ]
      }
      ap_card_receivable: {
        Row: {
          amount: number
          created_at: string
          date_from: string
          date_to: string
          hotel_id: string
          id: string
          informed_by: string
        }
        Insert: {
          amount: number
          created_at?: string
          date_from: string
          date_to: string
          hotel_id: string
          id?: string
          informed_by: string
        }
        Update: {
          amount?: number
          created_at?: string
          date_from?: string
          date_to?: string
          hotel_id?: string
          id?: string
          informed_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "ap_card_receivable_hotel_id_fkey"
            columns: ["hotel_id"]
            isOneToOne: false
            referencedRelation: "hotels"
            referencedColumns: ["id"]
          },
        ]
      }
      ap_documents: {
        Row: {
          doc_cnpj: string | null
          doc_type: string | null
          entry_id: string | null
          file_name: string
          file_path: string
          file_size: number | null
          hotel_id: string
          id: string
          mime_type: string | null
          nf_amount: number | null
          upload_id: string | null
          uploaded_at: string
          uploaded_by: string
          validated_at: string | null
          validation_details: Json | null
          validation_status: string | null
        }
        Insert: {
          doc_cnpj?: string | null
          doc_type?: string | null
          entry_id?: string | null
          file_name: string
          file_path: string
          file_size?: number | null
          hotel_id: string
          id?: string
          mime_type?: string | null
          nf_amount?: number | null
          upload_id?: string | null
          uploaded_at?: string
          uploaded_by: string
          validated_at?: string | null
          validation_details?: Json | null
          validation_status?: string | null
        }
        Update: {
          doc_cnpj?: string | null
          doc_type?: string | null
          entry_id?: string | null
          file_name?: string
          file_path?: string
          file_size?: number | null
          hotel_id?: string
          id?: string
          mime_type?: string | null
          nf_amount?: number | null
          upload_id?: string | null
          uploaded_at?: string
          uploaded_by?: string
          validated_at?: string | null
          validation_details?: Json | null
          validation_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ap_documents_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "ap_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_documents_hotel_id_fkey"
            columns: ["hotel_id"]
            isOneToOne: false
            referencedRelation: "hotels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_documents_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "ap_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      ap_entries: {
        Row: {
          amount: number
          archived_at: string | null
          archived_reason: string | null
          bank_account: string | null
          category: string | null
          cnpj: string | null
          created_at: string
          description: string | null
          document_number: string | null
          due_date: string | null
          entry_key: string
          gg_approval: Database["public"]["Enums"]["ap_entry_approval"]
          gg_approval_at: string | null
          gg_approval_by: string | null
          gg_approval_notes: string | null
          hotel_cnpj: string | null
          hotel_id: string
          id: string
          interest_fees: number | null
          is_distribution: boolean
          lookup_key: string | null
          observation: string | null
          omie_situation: string | null
          paid_amount: number | null
          paid_interest: number | null
          payment_marked_at: string | null
          payment_marked_by: string | null
          payment_method: string | null
          payment_paid_at: string | null
          payment_status: Database["public"]["Enums"]["ap_payment_status"]
          primary_document_id: string | null
          raw: Json
          scheduled_date: string | null
          source_system: Database["public"]["Enums"]["financial_system"]
          supplier: string
          updated_at: string
          upload_id: string
        }
        Insert: {
          amount: number
          archived_at?: string | null
          archived_reason?: string | null
          bank_account?: string | null
          category?: string | null
          cnpj?: string | null
          created_at?: string
          description?: string | null
          document_number?: string | null
          due_date?: string | null
          entry_key: string
          gg_approval?: Database["public"]["Enums"]["ap_entry_approval"]
          gg_approval_at?: string | null
          gg_approval_by?: string | null
          gg_approval_notes?: string | null
          hotel_cnpj?: string | null
          hotel_id: string
          id?: string
          interest_fees?: number | null
          is_distribution?: boolean
          lookup_key?: string | null
          observation?: string | null
          omie_situation?: string | null
          paid_amount?: number | null
          paid_interest?: number | null
          payment_marked_at?: string | null
          payment_marked_by?: string | null
          payment_method?: string | null
          payment_paid_at?: string | null
          payment_status?: Database["public"]["Enums"]["ap_payment_status"]
          primary_document_id?: string | null
          raw?: Json
          scheduled_date?: string | null
          source_system: Database["public"]["Enums"]["financial_system"]
          supplier: string
          updated_at?: string
          upload_id: string
        }
        Update: {
          amount?: number
          archived_at?: string | null
          archived_reason?: string | null
          bank_account?: string | null
          category?: string | null
          cnpj?: string | null
          created_at?: string
          description?: string | null
          document_number?: string | null
          due_date?: string | null
          entry_key?: string
          gg_approval?: Database["public"]["Enums"]["ap_entry_approval"]
          gg_approval_at?: string | null
          gg_approval_by?: string | null
          gg_approval_notes?: string | null
          hotel_cnpj?: string | null
          hotel_id?: string
          id?: string
          interest_fees?: number | null
          is_distribution?: boolean
          lookup_key?: string | null
          observation?: string | null
          omie_situation?: string | null
          paid_amount?: number | null
          paid_interest?: number | null
          payment_marked_at?: string | null
          payment_marked_by?: string | null
          payment_method?: string | null
          payment_paid_at?: string | null
          payment_status?: Database["public"]["Enums"]["ap_payment_status"]
          primary_document_id?: string | null
          raw?: Json
          scheduled_date?: string | null
          source_system?: Database["public"]["Enums"]["financial_system"]
          supplier?: string
          updated_at?: string
          upload_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ap_entries_hotel_id_fkey"
            columns: ["hotel_id"]
            isOneToOne: false
            referencedRelation: "hotels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_entries_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "ap_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      ap_notification_log: {
        Row: {
          entries_snapshot: Json
          entry_ids: string[]
          hotel_id: string
          id: string
          message_text: string | null
          recipient_emails: string[]
          sent_at: string
          sent_by: string
        }
        Insert: {
          entries_snapshot?: Json
          entry_ids?: string[]
          hotel_id: string
          id?: string
          message_text?: string | null
          recipient_emails?: string[]
          sent_at?: string
          sent_by: string
        }
        Update: {
          entries_snapshot?: Json
          entry_ids?: string[]
          hotel_id?: string
          id?: string
          message_text?: string | null
          recipient_emails?: string[]
          sent_at?: string
          sent_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "ap_notification_log_hotel_id_fkey"
            columns: ["hotel_id"]
            isOneToOne: false
            referencedRelation: "hotels"
            referencedColumns: ["id"]
          },
        ]
      }
      ap_uploads: {
        Row: {
          file_name: string
          file_path: string
          file_size: number | null
          hotel_id: string
          id: string
          kind: string
          metadata: Json
          parse_error: string | null
          parsed_entries_count: number | null
          source_system: Database["public"]["Enums"]["financial_system"]
          uploaded_at: string
          uploaded_by: string
        }
        Insert: {
          file_name: string
          file_path: string
          file_size?: number | null
          hotel_id: string
          id?: string
          kind: string
          metadata?: Json
          parse_error?: string | null
          parsed_entries_count?: number | null
          source_system: Database["public"]["Enums"]["financial_system"]
          uploaded_at?: string
          uploaded_by: string
        }
        Update: {
          file_name?: string
          file_path?: string
          file_size?: number | null
          hotel_id?: string
          id?: string
          kind?: string
          metadata?: Json
          parse_error?: string | null
          parsed_entries_count?: number | null
          source_system?: Database["public"]["Enums"]["financial_system"]
          uploaded_at?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "ap_uploads_hotel_id_fkey"
            columns: ["hotel_id"]
            isOneToOne: false
            referencedRelation: "hotels"
            referencedColumns: ["id"]
          },
        ]
      }
      approvals: {
        Row: {
          approved_by: string
          closing_id: string
          created_at: string
          id: string
          notes: string | null
          stage: Database["public"]["Enums"]["closing_stage"]
          status: Database["public"]["Enums"]["closing_status"]
        }
        Insert: {
          approved_by: string
          closing_id: string
          created_at?: string
          id?: string
          notes?: string | null
          stage: Database["public"]["Enums"]["closing_stage"]
          status: Database["public"]["Enums"]["closing_status"]
        }
        Update: {
          approved_by?: string
          closing_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          stage?: Database["public"]["Enums"]["closing_stage"]
          status?: Database["public"]["Enums"]["closing_status"]
        }
        Relationships: [
          {
            foreignKeyName: "approvals_closing_id_fkey"
            columns: ["closing_id"]
            isOneToOne: false
            referencedRelation: "closings"
            referencedColumns: ["id"]
          },
        ]
      }
      ar_client_contracts: {
        Row: {
          account_name: string | null
          account_number: string | null
          created_at: string
          created_by: string
          hotel_id: string
          id: string
          notes: string | null
          payment_term_days: number
          updated_at: string
        }
        Insert: {
          account_name?: string | null
          account_number?: string | null
          created_at?: string
          created_by: string
          hotel_id: string
          id?: string
          notes?: string | null
          payment_term_days: number
          updated_at?: string
        }
        Update: {
          account_name?: string | null
          account_number?: string | null
          created_at?: string
          created_by?: string
          hotel_id?: string
          id?: string
          notes?: string | null
          payment_term_days?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ar_client_contracts_hotel_id_fkey"
            columns: ["hotel_id"]
            isOneToOne: false
            referencedRelation: "hotels"
            referencedColumns: ["id"]
          },
        ]
      }
      ar_open_folio_entries: {
        Row: {
          archived_at: string | null
          arrival_date: string | null
          balance: number | null
          confirmation_number: string | null
          created_at: string
          days_open: number | null
          departure_date: string | null
          entry_key: string | null
          expected_payment_date: string | null
          extraction_date: string | null
          first_name: string | null
          hotel_id: string | null
          id: string
          last_name: string | null
          property_name_raw: string
          raw: Json
          reservation_status: string | null
          upload_id: string
        }
        Insert: {
          archived_at?: string | null
          arrival_date?: string | null
          balance?: number | null
          confirmation_number?: string | null
          created_at?: string
          days_open?: number | null
          departure_date?: string | null
          entry_key?: string | null
          expected_payment_date?: string | null
          extraction_date?: string | null
          first_name?: string | null
          hotel_id?: string | null
          id?: string
          last_name?: string | null
          property_name_raw: string
          raw?: Json
          reservation_status?: string | null
          upload_id: string
        }
        Update: {
          archived_at?: string | null
          arrival_date?: string | null
          balance?: number | null
          confirmation_number?: string | null
          created_at?: string
          days_open?: number | null
          departure_date?: string | null
          entry_key?: string | null
          expected_payment_date?: string | null
          extraction_date?: string | null
          first_name?: string | null
          hotel_id?: string | null
          id?: string
          last_name?: string | null
          property_name_raw?: string
          raw?: Json
          reservation_status?: string | null
          upload_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ar_open_folio_entries_hotel_id_fkey"
            columns: ["hotel_id"]
            isOneToOne: false
            referencedRelation: "hotels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ar_open_folio_entries_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "ar_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      ar_open_folio_notes: {
        Row: {
          author_id: string
          confirmation_number: string
          created_at: string
          expected_payment_date: string | null
          hotel_id: string
          id: string
          note: string
          updated_at: string
        }
        Insert: {
          author_id: string
          confirmation_number: string
          created_at?: string
          expected_payment_date?: string | null
          hotel_id: string
          id?: string
          note: string
          updated_at?: string
        }
        Update: {
          author_id?: string
          confirmation_number?: string
          created_at?: string
          expected_payment_date?: string | null
          hotel_id?: string
          id?: string
          note?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ar_open_folio_notes_hotel_id_fkey"
            columns: ["hotel_id"]
            isOneToOne: false
            referencedRelation: "hotels"
            referencedColumns: ["id"]
          },
        ]
      }
      ar_to_invoice_entries: {
        Row: {
          account_name: string | null
          account_number: string | null
          account_type: string | null
          amount: number | null
          ar_open: number | null
          confirmation_number: string | null
          created_at: string
          departure_date: string | null
          entry_key: string
          estimated_due_date: string | null
          gg_confirmed_at: string | null
          gg_confirmed_by: string | null
          gg_note: string | null
          gg_status: Database["public"]["Enums"]["ar_gg_status"]
          hotel_id: string | null
          id: string
          invoice_number: string | null
          invoice_status: string | null
          original_amount: number | null
          paid: number | null
          paid_date: string | null
          paid_note: string | null
          property_name_raw: string
          raw: Json
          reservation_status: string | null
          transaction_date: string | null
          upload_id: string
        }
        Insert: {
          account_name?: string | null
          account_number?: string | null
          account_type?: string | null
          amount?: number | null
          ar_open?: number | null
          confirmation_number?: string | null
          created_at?: string
          departure_date?: string | null
          entry_key: string
          estimated_due_date?: string | null
          gg_confirmed_at?: string | null
          gg_confirmed_by?: string | null
          gg_note?: string | null
          gg_status?: Database["public"]["Enums"]["ar_gg_status"]
          hotel_id?: string | null
          id?: string
          invoice_number?: string | null
          invoice_status?: string | null
          original_amount?: number | null
          paid?: number | null
          paid_date?: string | null
          paid_note?: string | null
          property_name_raw: string
          raw?: Json
          reservation_status?: string | null
          transaction_date?: string | null
          upload_id: string
        }
        Update: {
          account_name?: string | null
          account_number?: string | null
          account_type?: string | null
          amount?: number | null
          ar_open?: number | null
          confirmation_number?: string | null
          created_at?: string
          departure_date?: string | null
          entry_key?: string
          estimated_due_date?: string | null
          gg_confirmed_at?: string | null
          gg_confirmed_by?: string | null
          gg_note?: string | null
          gg_status?: Database["public"]["Enums"]["ar_gg_status"]
          hotel_id?: string | null
          id?: string
          invoice_number?: string | null
          invoice_status?: string | null
          original_amount?: number | null
          paid?: number | null
          paid_date?: string | null
          paid_note?: string | null
          property_name_raw?: string
          raw?: Json
          reservation_status?: string | null
          transaction_date?: string | null
          upload_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ar_to_invoice_entries_hotel_id_fkey"
            columns: ["hotel_id"]
            isOneToOne: false
            referencedRelation: "hotels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ar_to_invoice_entries_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "ar_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      ar_uploads: {
        Row: {
          file_name: string
          file_path: string
          file_size: number | null
          id: string
          kind: string
          metadata: Json
          parse_error: string | null
          parsed_rows_count: number | null
          unmapped_properties: Json
          uploaded_at: string
          uploaded_by: string
        }
        Insert: {
          file_name: string
          file_path: string
          file_size?: number | null
          id?: string
          kind: string
          metadata?: Json
          parse_error?: string | null
          parsed_rows_count?: number | null
          unmapped_properties?: Json
          uploaded_at?: string
          uploaded_by: string
        }
        Update: {
          file_name?: string
          file_path?: string
          file_size?: number | null
          id?: string
          kind?: string
          metadata?: Json
          parse_error?: string | null
          parsed_rows_count?: number | null
          unmapped_properties?: Json
          uploaded_at?: string
          uploaded_by?: string
        }
        Relationships: []
      }
      closing_status_log: {
        Row: {
          changed_by: string | null
          closing_id: string
          created_at: string
          field: string
          id: string
          new_value: Database["public"]["Enums"]["closing_status"]
          old_value: Database["public"]["Enums"]["closing_status"] | null
        }
        Insert: {
          changed_by?: string | null
          closing_id: string
          created_at?: string
          field: string
          id?: string
          new_value: Database["public"]["Enums"]["closing_status"]
          old_value?: Database["public"]["Enums"]["closing_status"] | null
        }
        Update: {
          changed_by?: string | null
          closing_id?: string
          created_at?: string
          field?: string
          id?: string
          new_value?: Database["public"]["Enums"]["closing_status"]
          old_value?: Database["public"]["Enums"]["closing_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "closing_status_log_closing_id_fkey"
            columns: ["closing_id"]
            isOneToOne: false
            referencedRelation: "closings"
            referencedColumns: ["id"]
          },
        ]
      }
      closings: {
        Row: {
          carta_approved_at: string | null
          carta_started_at: string | null
          created_at: string
          distribution_decided_at: string | null
          distribution_decided_by: string | null
          distribution_decision: string | null
          distribution_notes: string | null
          dre_approved_at: string | null
          dre_started_at: string | null
          envio_sent_at: string | null
          estimated_at: string | null
          estimated_distribution: number | null
          estimated_email_sent_at: string | null
          estimated_lines: Json | null
          final_distribution: number | null
          financeiro_resolved_at: string | null
          financeiro_started_at: string | null
          hotel_id: string
          id: string
          month: number
          status_carta: Database["public"]["Enums"]["closing_status"]
          status_dre: Database["public"]["Enums"]["closing_status"]
          status_envio: Database["public"]["Enums"]["closing_status"]
          status_financeiro: Database["public"]["Enums"]["closing_status"]
          updated_at: string
          year: number
        }
        Insert: {
          carta_approved_at?: string | null
          carta_started_at?: string | null
          created_at?: string
          distribution_decided_at?: string | null
          distribution_decided_by?: string | null
          distribution_decision?: string | null
          distribution_notes?: string | null
          dre_approved_at?: string | null
          dre_started_at?: string | null
          envio_sent_at?: string | null
          estimated_at?: string | null
          estimated_distribution?: number | null
          estimated_email_sent_at?: string | null
          estimated_lines?: Json | null
          final_distribution?: number | null
          financeiro_resolved_at?: string | null
          financeiro_started_at?: string | null
          hotel_id: string
          id?: string
          month: number
          status_carta?: Database["public"]["Enums"]["closing_status"]
          status_dre?: Database["public"]["Enums"]["closing_status"]
          status_envio?: Database["public"]["Enums"]["closing_status"]
          status_financeiro?: Database["public"]["Enums"]["closing_status"]
          updated_at?: string
          year: number
        }
        Update: {
          carta_approved_at?: string | null
          carta_started_at?: string | null
          created_at?: string
          distribution_decided_at?: string | null
          distribution_decided_by?: string | null
          distribution_decision?: string | null
          distribution_notes?: string | null
          dre_approved_at?: string | null
          dre_started_at?: string | null
          envio_sent_at?: string | null
          estimated_at?: string | null
          estimated_distribution?: number | null
          estimated_email_sent_at?: string | null
          estimated_lines?: Json | null
          final_distribution?: number | null
          financeiro_resolved_at?: string | null
          financeiro_started_at?: string | null
          hotel_id?: string
          id?: string
          month?: number
          status_carta?: Database["public"]["Enums"]["closing_status"]
          status_dre?: Database["public"]["Enums"]["closing_status"]
          status_envio?: Database["public"]["Enums"]["closing_status"]
          status_financeiro?: Database["public"]["Enums"]["closing_status"]
          updated_at?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "closings_hotel_id_fkey"
            columns: ["hotel_id"]
            isOneToOne: false
            referencedRelation: "hotels"
            referencedColumns: ["id"]
          },
        ]
      }
      comments: {
        Row: {
          author_id: string
          closing_id: string
          content: string
          created_at: string
          id: string
          stage: Database["public"]["Enums"]["closing_stage"]
        }
        Insert: {
          author_id: string
          closing_id: string
          content: string
          created_at?: string
          id?: string
          stage: Database["public"]["Enums"]["closing_stage"]
        }
        Update: {
          author_id?: string
          closing_id?: string
          content?: string
          created_at?: string
          id?: string
          stage?: Database["public"]["Enums"]["closing_stage"]
        }
        Relationships: [
          {
            foreignKeyName: "comments_closing_id_fkey"
            columns: ["closing_id"]
            isOneToOne: false
            referencedRelation: "closings"
            referencedColumns: ["id"]
          },
        ]
      }
      conciliation_journal_lines: {
        Row: {
          categoria: string | null
          company_name: string | null
          credit: number | null
          debit: number | null
          guest_first_name: string | null
          guest_last_name: string | null
          id: string
          line_date: string
          receipt_number: string | null
          transaction_code: string
          transaction_description: string | null
          transaction_number: string
          upload_id: string
        }
        Insert: {
          categoria?: string | null
          company_name?: string | null
          credit?: number | null
          debit?: number | null
          guest_first_name?: string | null
          guest_last_name?: string | null
          id?: string
          line_date: string
          receipt_number?: string | null
          transaction_code: string
          transaction_description?: string | null
          transaction_number: string
          upload_id: string
        }
        Update: {
          categoria?: string | null
          company_name?: string | null
          credit?: number | null
          debit?: number | null
          guest_first_name?: string | null
          guest_last_name?: string | null
          id?: string
          line_date?: string
          receipt_number?: string | null
          transaction_code?: string
          transaction_description?: string | null
          transaction_number?: string
          upload_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conciliation_journal_lines_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "conciliation_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      conciliation_razao_lines: {
        Row: {
          descricao: string
          documento: string | null
          historico: string | null
          id: string
          is_totalizador: boolean | null
          lancamento: string | null
          line_date: string
          upload_id: string
          valor_credito: number | null
          valor_debito: number | null
        }
        Insert: {
          descricao: string
          documento?: string | null
          historico?: string | null
          id?: string
          is_totalizador?: boolean | null
          lancamento?: string | null
          line_date: string
          upload_id: string
          valor_credito?: number | null
          valor_debito?: number | null
        }
        Update: {
          descricao?: string
          documento?: string | null
          historico?: string | null
          id?: string
          is_totalizador?: boolean | null
          lancamento?: string | null
          line_date?: string
          upload_id?: string
          valor_credito?: number | null
          valor_debito?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "conciliation_razao_lines_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "conciliation_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      conciliation_uploads: {
        Row: {
          created_at: string | null
          hotel_id: string
          id: string
          journal_file_name: string | null
          period: string
          razao_file_name: string | null
          status: string | null
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string | null
          hotel_id: string
          id?: string
          journal_file_name?: string | null
          period: string
          razao_file_name?: string | null
          status?: string | null
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string | null
          hotel_id?: string
          id?: string
          journal_file_name?: string | null
          period?: string
          razao_file_name?: string | null
          status?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conciliation_uploads_hotel_id_fkey"
            columns: ["hotel_id"]
            isOneToOne: false
            referencedRelation: "hotels"
            referencedColumns: ["id"]
          },
        ]
      }
      dre_parsed_lines: {
        Row: {
          closing_id: string
          created_at: string
          id: string
          line_category: string | null
          line_label: string
          line_level: number | null
          line_segment: string | null
          line_type: string
          line_value: number | null
          version_number: number
        }
        Insert: {
          closing_id: string
          created_at?: string
          id?: string
          line_category?: string | null
          line_label: string
          line_level?: number | null
          line_segment?: string | null
          line_type?: string
          line_value?: number | null
          version_number: number
        }
        Update: {
          closing_id?: string
          created_at?: string
          id?: string
          line_category?: string | null
          line_label?: string
          line_level?: number | null
          line_segment?: string | null
          line_type?: string
          line_value?: number | null
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "dre_parsed_lines_closing_id_fkey"
            columns: ["closing_id"]
            isOneToOne: false
            referencedRelation: "closings"
            referencedColumns: ["id"]
          },
        ]
      }
      dre_versions: {
        Row: {
          author_id: string
          closing_id: string
          created_at: string
          file_name: string
          file_url: string
          id: string
          version_number: number
        }
        Insert: {
          author_id: string
          closing_id: string
          created_at?: string
          file_name: string
          file_url: string
          id?: string
          version_number: number
        }
        Update: {
          author_id?: string
          closing_id?: string
          created_at?: string
          file_name?: string
          file_url?: string
          id?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "dre_versions_closing_id_fkey"
            columns: ["closing_id"]
            isOneToOne: false
            referencedRelation: "closings"
            referencedColumns: ["id"]
          },
        ]
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      hotels: {
        Row: {
          active: boolean
          brand: string
          brand_logo_url: string | null
          cnpj: string | null
          cover_url: string | null
          created_at: string
          financial_system:
            | Database["public"]["Enums"]["financial_system"]
            | null
          id: string
          name: string
          opera_property_name: string | null
          show_in_closing: boolean
        }
        Insert: {
          active?: boolean
          brand: string
          brand_logo_url?: string | null
          cnpj?: string | null
          cover_url?: string | null
          created_at?: string
          financial_system?:
            | Database["public"]["Enums"]["financial_system"]
            | null
          id: string
          name: string
          opera_property_name?: string | null
          show_in_closing?: boolean
        }
        Update: {
          active?: boolean
          brand?: string
          brand_logo_url?: string | null
          cnpj?: string | null
          cover_url?: string | null
          created_at?: string
          financial_system?:
            | Database["public"]["Enums"]["financial_system"]
            | null
          id?: string
          name?: string
          opera_property_name?: string | null
          show_in_closing?: boolean
        }
        Relationships: []
      }
      investor_letters: {
        Row: {
          ai_closing: string | null
          ai_financial: string | null
          ai_generated_at: string | null
          ai_intro: string | null
          ai_market_context: string | null
          ai_model: string | null
          ai_operational: string | null
          ai_outlook: string | null
          ai_version_number: number
          closing_id: string
          created_at: string
          created_by: string
          custom_notes: string | null
          highlight_costs: string | null
          highlight_market: string | null
          highlight_operations: string | null
          highlight_outlook: string | null
          highlight_revenue: string | null
          id: string
          last_ai_instruction: string | null
          operational_comment: string | null
          pdf_generated_at: string | null
          pdf_url: string | null
          pdf_version: number
          reserve_fund: number | null
          rps_score: number | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          ai_closing?: string | null
          ai_financial?: string | null
          ai_generated_at?: string | null
          ai_intro?: string | null
          ai_market_context?: string | null
          ai_model?: string | null
          ai_operational?: string | null
          ai_outlook?: string | null
          ai_version_number?: number
          closing_id: string
          created_at?: string
          created_by: string
          custom_notes?: string | null
          highlight_costs?: string | null
          highlight_market?: string | null
          highlight_operations?: string | null
          highlight_outlook?: string | null
          highlight_revenue?: string | null
          id?: string
          last_ai_instruction?: string | null
          operational_comment?: string | null
          pdf_generated_at?: string | null
          pdf_url?: string | null
          pdf_version?: number
          reserve_fund?: number | null
          rps_score?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          ai_closing?: string | null
          ai_financial?: string | null
          ai_generated_at?: string | null
          ai_intro?: string | null
          ai_market_context?: string | null
          ai_model?: string | null
          ai_operational?: string | null
          ai_outlook?: string | null
          ai_version_number?: number
          closing_id?: string
          created_at?: string
          created_by?: string
          custom_notes?: string | null
          highlight_costs?: string | null
          highlight_market?: string | null
          highlight_operations?: string | null
          highlight_outlook?: string | null
          highlight_revenue?: string | null
          id?: string
          last_ai_instruction?: string | null
          operational_comment?: string | null
          pdf_generated_at?: string | null
          pdf_url?: string | null
          pdf_version?: number
          reserve_fund?: number | null
          rps_score?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "investor_letters_closing_id_fkey"
            columns: ["closing_id"]
            isOneToOne: true
            referencedRelation: "closings"
            referencedColumns: ["id"]
          },
        ]
      }
      letter_highlights: {
        Row: {
          closing_id: string
          created_at: string
          created_by: string
          id: string
          letter_id: string
          note: string | null
          photo_url: string | null
          sort_order: number
          title: string
          updated_at: string
        }
        Insert: {
          closing_id: string
          created_at?: string
          created_by: string
          id?: string
          letter_id: string
          note?: string | null
          photo_url?: string | null
          sort_order?: number
          title: string
          updated_at?: string
        }
        Update: {
          closing_id?: string
          created_at?: string
          created_by?: string
          id?: string
          letter_id?: string
          note?: string | null
          photo_url?: string | null
          sort_order?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "letter_highlights_closing_id_fkey"
            columns: ["closing_id"]
            isOneToOne: false
            referencedRelation: "closings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "letter_highlights_letter_id_fkey"
            columns: ["letter_id"]
            isOneToOne: false
            referencedRelation: "investor_letters"
            referencedColumns: ["id"]
          },
        ]
      }
      letter_versions: {
        Row: {
          ai_closing: string | null
          ai_financial: string | null
          ai_intro: string | null
          ai_market_context: string | null
          ai_model: string | null
          ai_operational: string | null
          ai_outlook: string | null
          closing_id: string
          created_at: string
          created_by: string | null
          id: string
          instruction: string | null
          letter_id: string
          version_number: number
        }
        Insert: {
          ai_closing?: string | null
          ai_financial?: string | null
          ai_intro?: string | null
          ai_market_context?: string | null
          ai_model?: string | null
          ai_operational?: string | null
          ai_outlook?: string | null
          closing_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          instruction?: string | null
          letter_id: string
          version_number: number
        }
        Update: {
          ai_closing?: string | null
          ai_financial?: string | null
          ai_intro?: string | null
          ai_market_context?: string | null
          ai_model?: string | null
          ai_operational?: string | null
          ai_outlook?: string | null
          closing_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          instruction?: string | null
          letter_id?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "letter_versions_closing_id_fkey"
            columns: ["closing_id"]
            isOneToOne: false
            referencedRelation: "closings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "letter_versions_letter_id_fkey"
            columns: ["letter_id"]
            isOneToOne: false
            referencedRelation: "investor_letters"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_queue: {
        Row: {
          body_md: string
          closing_id: string
          created_at: string
          dispatched_at: string | null
          error_message: string | null
          event: Database["public"]["Enums"]["notification_event"]
          hotel_id: string
          id: string
          link_url: string
          payload: Json
          recipient_email: string | null
          recipient_role: string | null
          recipient_user_id: string
          scheduled_at: string
          status: Database["public"]["Enums"]["notification_status"]
          subject: string
        }
        Insert: {
          body_md: string
          closing_id: string
          created_at?: string
          dispatched_at?: string | null
          error_message?: string | null
          event: Database["public"]["Enums"]["notification_event"]
          hotel_id: string
          id?: string
          link_url: string
          payload?: Json
          recipient_email?: string | null
          recipient_role?: string | null
          recipient_user_id: string
          scheduled_at?: string
          status?: Database["public"]["Enums"]["notification_status"]
          subject: string
        }
        Update: {
          body_md?: string
          closing_id?: string
          created_at?: string
          dispatched_at?: string | null
          error_message?: string | null
          event?: Database["public"]["Enums"]["notification_event"]
          hotel_id?: string
          id?: string
          link_url?: string
          payload?: Json
          recipient_email?: string | null
          recipient_role?: string | null
          recipient_user_id?: string
          scheduled_at?: string
          status?: Database["public"]["Enums"]["notification_status"]
          subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_queue_closing_id_fkey"
            columns: ["closing_id"]
            isOneToOne: false
            referencedRelation: "closings"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_unsubscribes: {
        Row: {
          created_at: string
          event: Database["public"]["Enums"]["notification_event"] | null
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          event?: Database["public"]["Enums"]["notification_event"] | null
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          event?: Database["public"]["Enums"]["notification_event"] | null
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          email: string | null
          financeiro_subrole: string | null
          id: string
          status: Database["public"]["Enums"]["user_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          financeiro_subrole?: string | null
          id?: string
          status?: Database["public"]["Enums"]["user_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          financeiro_subrole?: string | null
          id?: string
          status?: Database["public"]["Enums"]["user_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      system_settings: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: string | null
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value?: string | null
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: string | null
        }
        Relationships: []
      }
      user_hotels: {
        Row: {
          created_at: string
          hotel_id: string
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          hotel_id: string
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          hotel_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_hotels_hotel_id_fkey"
            columns: ["hotel_id"]
            isOneToOne: false
            referencedRelation: "hotels"
            referencedColumns: ["id"]
          },
        ]
      }
      user_permissions: {
        Row: {
          created_at: string
          granted_by: string | null
          id: string
          permission_key: string
          user_id: string
        }
        Insert: {
          created_at?: string
          granted_by?: string | null
          id?: string
          permission_key: string
          user_id: string
        }
        Update: {
          created_at?: string
          granted_by?: string | null
          id?: string
          permission_key?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          assigned_by: string | null
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          assigned_by?: string | null
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          assigned_by?: string | null
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      enqueue_workflow_notification: {
        Args: {
          _body_md: string
          _closing_id: string
          _event: Database["public"]["Enums"]["notification_event"]
          _hotel_id: string
          _link_url: string
          _payload?: Json
          _recipients: Json
          _subject: string
        }
        Returns: number
      }
      get_financeiro_subrole: { Args: { _user_id: string }; Returns: string }
      get_latest_dre_lines: {
        Args: { _closing_id: string }
        Returns: {
          line_category: string
          line_label: string
          line_level: number
          line_segment: string
          line_type: string
          line_value: number
          version_number: number
        }[]
      }
      get_latest_dre_lines_by_closings: {
        Args: { _closing_ids: string[] }
        Returns: {
          closing_id: string
          line_category: string
          line_label: string
          line_level: number
          line_segment: string
          line_type: string
          line_value: number
          version_number: number
        }[]
      }
      has_any_role: { Args: { _user_id: string }; Returns: boolean }
      has_global_data_access: { Args: { _user_id: string }; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_ap_manager: { Args: { _user_id: string }; Returns: boolean }
      is_ar_manager: { Args: { _user_id: string }; Returns: boolean }
      is_dre_uploader: { Args: { _user_id: string }; Returns: boolean }
      is_financeiro_coordenadora: {
        Args: { _user_id: string }
        Returns: boolean
      }
      is_financeiro_equipe: { Args: { _user_id: string }; Returns: boolean }
      is_hotel_allowed: {
        Args: { _hotel_id: string; _user_id: string }
        Returns: boolean
      }
      is_master: { Args: { _user_id: string }; Returns: boolean }
      is_protected_user: { Args: { _user_id: string }; Returns: boolean }
      is_unsubscribed: {
        Args: {
          _event: Database["public"]["Enums"]["notification_event"]
          _user_id: string
        }
        Returns: boolean
      }
      month_pt: { Args: { _m: number }; Returns: string }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      users_with_role_for_hotel: {
        Args: {
          _hotel_id: string
          _role: Database["public"]["Enums"]["app_role"]
        }
        Returns: {
          display_name: string
          email: string
          user_id: string
        }[]
      }
      users_with_role_global: {
        Args: { _role: Database["public"]["Enums"]["app_role"] }
        Returns: {
          display_name: string
          email: string
          user_id: string
        }[]
      }
    }
    Enums: {
      ap_entry_approval: "pending" | "approved" | "rejected"
      ap_payment_status:
        | "pendente"
        | "inserido"
        | "agendado"
        | "pago"
        | "em_aprovacao"
        | "autorizado"
      app_role:
        | "processos"
        | "fernando"
        | "controladoria"
        | "gop"
        | "ri"
        | "financeiro"
        | "gg"
        | "viewer"
        | "rh"
        | "operacoes"
      ar_gg_status: "pendente" | "faturado" | "nao_faturado"
      closing_stage: "dre" | "carta" | "financeiro" | "envio"
      closing_status:
        | "nao_iniciado"
        | "em_andamento"
        | "pendente"
        | "aprovado"
        | "devolvido"
        | "aguardando_comentarios"
        | "aguardando_controladoria"
        | "aguardando_gop"
        | "aguardando_fernando"
        | "aguardando_gg"
        | "nao_aplicavel"
        | "sem_distribuicao"
      financial_system: "totvs" | "omie"
      notification_event:
        | "dre_first_preview"
        | "dre_comment"
        | "dre_new_preview"
        | "dre_controladoria_approved"
        | "dre_gop_approved"
        | "dre_fernando_approved"
        | "dre_returned"
        | "carta_gg_approved"
        | "carta_comment"
        | "carta_gop_approved"
        | "carta_fernando_approved"
        | "carta_returned"
        | "ap_pendencies_to_gg"
        | "open_folio_pendencies_to_gg"
        | "open_folio_overdue"
      notification_status: "pending" | "dispatched" | "failed" | "skipped"
      user_status: "active" | "pending" | "banned"
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
    Enums: {
      ap_entry_approval: ["pending", "approved", "rejected"],
      ap_payment_status: [
        "pendente",
        "inserido",
        "agendado",
        "pago",
        "em_aprovacao",
        "autorizado",
      ],
      app_role: [
        "processos",
        "fernando",
        "controladoria",
        "gop",
        "ri",
        "financeiro",
        "gg",
        "viewer",
        "rh",
        "operacoes",
      ],
      ar_gg_status: ["pendente", "faturado", "nao_faturado"],
      closing_stage: ["dre", "carta", "financeiro", "envio"],
      closing_status: [
        "nao_iniciado",
        "em_andamento",
        "pendente",
        "aprovado",
        "devolvido",
        "aguardando_comentarios",
        "aguardando_controladoria",
        "aguardando_gop",
        "aguardando_fernando",
        "aguardando_gg",
        "nao_aplicavel",
        "sem_distribuicao",
      ],
      financial_system: ["totvs", "omie"],
      notification_event: [
        "dre_first_preview",
        "dre_comment",
        "dre_new_preview",
        "dre_controladoria_approved",
        "dre_gop_approved",
        "dre_fernando_approved",
        "dre_returned",
        "carta_gg_approved",
        "carta_comment",
        "carta_gop_approved",
        "carta_fernando_approved",
        "carta_returned",
        "ap_pendencies_to_gg",
        "open_folio_pendencies_to_gg",
        "open_folio_overdue",
      ],
      notification_status: ["pending", "dispatched", "failed", "skipped"],
      user_status: ["active", "pending", "banned"],
    },
  },
} as const
