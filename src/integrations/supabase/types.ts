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
      agent_logs: {
        Row: {
          agent: string
          created_at: string
          event_id: string
          id: string
          level: string
          message: string
          user_id: string
        }
        Insert: {
          agent: string
          created_at?: string
          event_id: string
          id?: string
          level?: string
          message: string
          user_id: string
        }
        Update: {
          agent?: string
          created_at?: string
          event_id?: string
          id?: string
          level?: string
          message?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_logs_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      assets: {
        Row: {
          ai_summary: string | null
          analyzed: boolean
          created_at: string
          emotion: string | null
          event_id: string
          filename: string | null
          has_faces: boolean | null
          height: number | null
          id: string
          is_top_pick: boolean
          kind: string
          public_url: string | null
          quality_score: number | null
          scene: string | null
          storage_path: string
          user_id: string
          width: number | null
        }
        Insert: {
          ai_summary?: string | null
          analyzed?: boolean
          created_at?: string
          emotion?: string | null
          event_id: string
          filename?: string | null
          has_faces?: boolean | null
          height?: number | null
          id?: string
          is_top_pick?: boolean
          kind?: string
          public_url?: string | null
          quality_score?: number | null
          scene?: string | null
          storage_path: string
          user_id: string
          width?: number | null
        }
        Update: {
          ai_summary?: string | null
          analyzed?: boolean
          created_at?: string
          emotion?: string | null
          event_id?: string
          filename?: string | null
          has_faces?: boolean | null
          height?: number | null
          id?: string
          is_top_pick?: boolean
          kind?: string
          public_url?: string | null
          quality_score?: number | null
          scene?: string | null
          storage_path?: string
          user_id?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "assets_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          asset_count: number
          audience: string | null
          brand_color: string | null
          created_at: string
          description: string | null
          id: string
          name: string
          post_count: number
          status: string
          top_pick_count: number
          updated_at: string
          user_id: string
        }
        Insert: {
          asset_count?: number
          audience?: string | null
          brand_color?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name: string
          post_count?: number
          status?: string
          top_pick_count?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          asset_count?: number
          audience?: string | null
          brand_color?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          post_count?: number
          status?: string
          top_pick_count?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      generated_posts: {
        Row: {
          audience: string | null
          best_time: string | null
          caption: string | null
          created_at: string
          engagement_score: number | null
          event_id: string
          format: string
          hashtags: string[] | null
          id: string
          image_url: string | null
          metrics: Json
          platform: string
          predicted_engagement: number | null
          source_asset_id: string | null
          storage_path: string | null
          user_id: string
        }
        Insert: {
          audience?: string | null
          best_time?: string | null
          caption?: string | null
          created_at?: string
          engagement_score?: number | null
          event_id: string
          format: string
          hashtags?: string[] | null
          id?: string
          image_url?: string | null
          metrics?: Json
          platform: string
          predicted_engagement?: number | null
          source_asset_id?: string | null
          storage_path?: string | null
          user_id: string
        }
        Update: {
          audience?: string | null
          best_time?: string | null
          caption?: string | null
          created_at?: string
          engagement_score?: number | null
          event_id?: string
          format?: string
          hashtags?: string[] | null
          id?: string
          image_url?: string | null
          metrics?: Json
          platform?: string
          predicted_engagement?: number | null
          source_asset_id?: string | null
          storage_path?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "generated_posts_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generated_posts_source_asset_id_fkey"
            columns: ["source_asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
