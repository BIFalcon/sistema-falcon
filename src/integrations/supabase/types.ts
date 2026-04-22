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
      dre_parsed_lines: {
        Row: {
          closing_id: string
          created_at: string
          id: string
          line_label: string
          line_type: string
          line_value: number | null
          version_number: number
        }
        Insert: {
          closing_id: string
          created_at?: string
          id?: string
          line_label: string
          line_type?: string
          line_value?: number | null
          version_number: number
        }
        Update: {
          closing_id?: string
          created_at?: string
          id?: string
          line_label?: string
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
      hotels: {
        Row: {
          active: boolean
          brand: string
          created_at: string
          id: string
          name: string
        }
        Insert: {
          active?: boolean
          brand: string
          created_at?: string
          id: string
          name: string
        }
        Update: {
          active?: boolean
          brand?: string
          created_at?: string
          id?: string
          name?: string
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
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          updated_at?: string
          user_id?: string
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
      has_any_role: { Args: { _user_id: string }; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_dre_uploader: { Args: { _user_id: string }; Returns: boolean }
      is_hotel_allowed: {
        Args: { _hotel_id: string; _user_id: string }
        Returns: boolean
      }
      is_master: { Args: { _user_id: string }; Returns: boolean }
    }
    Enums: {
      app_role:
        | "processos"
        | "fernando"
        | "controladoria"
        | "gop"
        | "ri"
        | "financeiro"
        | "gg"
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
      app_role: [
        "processos",
        "fernando",
        "controladoria",
        "gop",
        "ri",
        "financeiro",
        "gg",
      ],
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
    },
  },
} as const
