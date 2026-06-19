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
      alerts: {
        Row: {
          channel: string
          error: string | null
          id: string
          sent_at: string
          setup_id: string
          status: string
          user_id: string
        }
        Insert: {
          channel: string
          error?: string | null
          id?: string
          sent_at?: string
          setup_id: string
          status?: string
          user_id: string
        }
        Update: {
          channel?: string
          error?: string | null
          id?: string
          sent_at?: string
          setup_id?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "alerts_setup_id_fkey"
            columns: ["setup_id"]
            isOneToOne: false
            referencedRelation: "setups"
            referencedColumns: ["id"]
          },
        ]
      }
      model_versions: {
        Row: {
          accuracy: number | null
          created_at: string
          id: string
          model_topology: Json
          trained_on: number
          version: number
          weights_b64: string
        }
        Insert: {
          accuracy?: number | null
          created_at?: string
          id?: string
          model_topology: Json
          trained_on?: number
          version: number
          weights_b64: string
        }
        Update: {
          accuracy?: number | null
          created_at?: string
          id?: string
          model_topology?: Json
          trained_on?: number
          version?: number
          weights_b64?: string
        }
        Relationships: []
      }
      pairs: {
        Row: {
          asset_class: string
          created_at: string
          display_name: string
          is_active: boolean
          symbol: string
        }
        Insert: {
          asset_class?: string
          created_at?: string
          display_name: string
          is_active?: boolean
          symbol: string
        }
        Update: {
          asset_class?: string
          created_at?: string
          display_name?: string
          is_active?: boolean
          symbol?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          active_pairs: string[]
          active_timeframes: string[]
          alerts_enabled: boolean
          created_at: string
          display_name: string | null
          id: string
          min_score: number
          risk_pct: number
          telegram_chat_id: string | null
          updated_at: string
        }
        Insert: {
          active_pairs?: string[]
          active_timeframes?: string[]
          alerts_enabled?: boolean
          created_at?: string
          display_name?: string | null
          id: string
          min_score?: number
          risk_pct?: number
          telegram_chat_id?: string | null
          updated_at?: string
        }
        Update: {
          active_pairs?: string[]
          active_timeframes?: string[]
          alerts_enabled?: boolean
          created_at?: string
          display_name?: string | null
          id?: string
          min_score?: number
          risk_pct?: number
          telegram_chat_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      setups: {
        Row: {
          closed_at: string | null
          created_at: string
          detected_at: string
          direction: string
          entry: number
          expires_at: string | null
          ict_context: Json
          id: string
          rr: number | null
          score: number
          sl: number
          status: string
          symbol: string
          timeframe: string
          tp1: number
          tp2: number | null
          updated_at: string
          wave_context: Json
        }
        Insert: {
          closed_at?: string | null
          created_at?: string
          detected_at?: string
          direction: string
          entry: number
          expires_at?: string | null
          ict_context?: Json
          id?: string
          rr?: number | null
          score?: number
          sl: number
          status?: string
          symbol: string
          timeframe: string
          tp1: number
          tp2?: number | null
          updated_at?: string
          wave_context?: Json
        }
        Update: {
          closed_at?: string | null
          created_at?: string
          detected_at?: string
          direction?: string
          entry?: number
          expires_at?: string | null
          ict_context?: Json
          id?: string
          rr?: number | null
          score?: number
          sl?: number
          status?: string
          symbol?: string
          timeframe?: string
          tp1?: number
          tp2?: number | null
          updated_at?: string
          wave_context?: Json
        }
        Relationships: [
          {
            foreignKeyName: "setups_symbol_fkey"
            columns: ["symbol"]
            isOneToOne: false
            referencedRelation: "pairs"
            referencedColumns: ["symbol"]
          },
        ]
      }
      trade_results: {
        Row: {
          evaluated_at: string
          id: string
          outcome: string
          r_multiple: number | null
          setup_id: string
        }
        Insert: {
          evaluated_at?: string
          id?: string
          outcome: string
          r_multiple?: number | null
          setup_id: string
        }
        Update: {
          evaluated_at?: string
          id?: string
          outcome?: string
          r_multiple?: number | null
          setup_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trade_results_setup_id_fkey"
            columns: ["setup_id"]
            isOneToOne: false
            referencedRelation: "setups"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
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
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user"
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
      app_role: ["admin", "user"],
    },
  },
} as const
