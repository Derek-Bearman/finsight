// AUTO-GENERATED from the Supabase schema via the Supabase MCP
// `generate_typescript_types` (project camphmqvrzqpgrhdjafo). Regenerate after
// any migration. Do not edit by hand.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          actor_user_id: string | null
          created_at: string
          firm_id: string
          id: string
          metadata: Json
          target: string | null
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          created_at?: string
          firm_id: string
          id?: string
          metadata?: Json
          target?: string | null
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          created_at?: string
          firm_id?: string
          id?: string
          metadata?: Json
          target?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      firms: {
        Row: {
          created_at: string
          current_period_end: string | null
          grace_ends_at: string | null
          id: string
          name: string
          plan_status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          trial_ends_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_period_end?: string | null
          grace_ends_at?: string | null
          id?: string
          name: string
          plan_status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          trial_ends_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_period_end?: string | null
          grace_ends_at?: string | null
          id?: string
          name?: string
          plan_status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          trial_ends_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          email: string
          expires_at: string
          firm_id: string
          id: string
          invited_by: string | null
          role: Database["public"]["Enums"]["membership_role"]
          token_hash: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email: string
          expires_at?: string
          firm_id: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["membership_role"]
          token_hash: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          firm_id?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["membership_role"]
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          created_at: string
          firm_id: string
          id: string
          invited_by: string | null
          role: Database["public"]["Enums"]["membership_role"]
          status: Database["public"]["Enums"]["membership_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          firm_id: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["membership_role"]
          status?: Database["public"]["Enums"]["membership_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          firm_id?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["membership_role"]
          status?: Database["public"]["Enums"]["membership_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      qbo_connections: {
        Row: {
          access_token_enc: string | null
          access_token_expires_at: string | null
          company_name: string | null
          connected_by: string | null
          created_at: string
          firm_id: string
          id: string
          last_sync_error: string | null
          last_synced_at: string | null
          realm_id: string
          refresh_token_enc: string | null
          refresh_token_expires_at: string | null
          refresh_token_hard_expires_at: string | null
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          access_token_enc?: string | null
          access_token_expires_at?: string | null
          company_name?: string | null
          connected_by?: string | null
          created_at?: string
          firm_id: string
          id?: string
          last_sync_error?: string | null
          last_synced_at?: string | null
          realm_id: string
          refresh_token_enc?: string | null
          refresh_token_expires_at?: string | null
          refresh_token_hard_expires_at?: string | null
          status?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          access_token_enc?: string | null
          access_token_expires_at?: string | null
          company_name?: string | null
          connected_by?: string | null
          created_at?: string
          firm_id?: string
          id?: string
          last_sync_error?: string | null
          last_synced_at?: string | null
          realm_id?: string
          refresh_token_enc?: string | null
          refresh_token_expires_at?: string | null
          refresh_token_hard_expires_at?: string | null
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "qbo_connections_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qbo_connections_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qbo_connections_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces_metadata"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string
          created_by: string | null
          data: Json
          firm_id: string
          id: string
          industry_profile: string
          name: string
          source_local_id: string | null
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          data?: Json
          firm_id: string
          id?: string
          industry_profile: string
          name: string
          source_local_id?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          data?: Json
          firm_id?: string
          id?: string
          industry_profile?: string
          name?: string
          source_local_id?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "workspaces_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      workspaces_metadata: {
        Row: {
          account_count: number | null
          created_at: string | null
          created_by: string | null
          firm_id: string | null
          has_data: boolean | null
          id: string | null
          industry_profile: string | null
          name: string | null
          source_local_id: string | null
          updated_at: string | null
          value_count: number | null
        }
        Relationships: [
          {
            foreignKeyName: "workspaces_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      accept_invitation: { Args: { p_token: string }; Returns: string }
      apply_stripe_status: {
        Args: {
          p_current_period_end?: string
          p_grace_days?: number
          p_status: string
          p_stripe_customer_id: string
          p_stripe_subscription_id?: string
        }
        Returns: string
      }
      auth_firm_ids: { Args: Record<PropertyKey, never>; Returns: string[] }
      auth_has_firm_role: {
        Args: {
          allowed_roles: Database["public"]["Enums"]["membership_role"][]
          target_firm: string
        }
        Returns: boolean
      }
      create_firm_with_owner: {
        Args: {
          p_firm_name: string
          p_owner_user_id: string
          p_plan_status?: string
          p_stripe_customer_id?: string
          p_stripe_subscription_id?: string
          p_trial_days?: number
        }
        Returns: string
      }
      create_invitation: {
        Args: {
          p_email: string
          p_firm_id: string
          p_role?: Database["public"]["Enums"]["membership_role"]
        }
        Returns: string
      }
      list_firm_members: {
        Args: { p_firm_id: string }
        Returns: {
          membership_id: string
          user_id: string
          email: string
          role: Database["public"]["Enums"]["membership_role"]
          status: Database["public"]["Enums"]["membership_status"]
          created_at: string
        }[]
      }
      remove_membership: {
        Args: { p_membership_id: string }
        Returns: undefined
      }
      revoke_invitation: {
        Args: { p_invitation_id: string }
        Returns: undefined
      }
      set_membership_role: {
        Args: {
          p_membership_id: string
          p_new_role: Database["public"]["Enums"]["membership_role"]
        }
        Returns: undefined
      }
    }
    Enums: {
      membership_role: "owner" | "admin" | "member"
      membership_status: "active" | "invited" | "revoked"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DefaultSchema = Database["public"]

export type Tables<
  T extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"]),
> = (DefaultSchema["Tables"] & DefaultSchema["Views"])[T] extends {
  Row: infer R
}
  ? R
  : never

export type TablesInsert<T extends keyof DefaultSchema["Tables"]> =
  DefaultSchema["Tables"][T] extends { Insert: infer I } ? I : never

export type TablesUpdate<T extends keyof DefaultSchema["Tables"]> =
  DefaultSchema["Tables"][T] extends { Update: infer U } ? U : never

export type Enums<T extends keyof DefaultSchema["Enums"]> =
  DefaultSchema["Enums"][T]

export const Constants = {
  public: {
    Enums: {
      membership_role: ["owner", "admin", "member"],
      membership_status: ["active", "invited", "revoked"],
    },
  },
} as const
