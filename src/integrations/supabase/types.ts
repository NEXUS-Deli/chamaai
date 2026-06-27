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
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      campanhas: {
        Row: {
          agendada_para: string | null
          atualizada_em: string
          criada_em: string
          delay_maximo: number | null
          delay_mensagens: number | null
          delay_minimo: number | null
          delay_segundos: number
          entregues: number
          enviadas: number
          erros: number
          id: string
          instancia_nome: string | null
          instancia_token: string | null
          instancia_whatsapp: string | null
          mensagem: string
          midia_bucket: string | null
          midia_nome: string | null
          midia_path: string | null
          midia_url: string | null
          nome: string
          status: string
          total_contatos: number
          usuario_id: string
        }
        Insert: {
          agendada_para?: string | null
          atualizada_em?: string
          criada_em?: string
          delay_maximo?: number | null
          delay_mensagens?: number | null
          delay_minimo?: number | null
          delay_segundos?: number
          entregues?: number
          enviadas?: number
          erros?: number
          id?: string
          instancia_nome?: string | null
          instancia_token?: string | null
          instancia_whatsapp?: string | null
          mensagem: string
          midia_bucket?: string | null
          midia_nome?: string | null
          midia_path?: string | null
          midia_url?: string | null
          nome: string
          status?: string
          total_contatos?: number
          usuario_id: string
        }
        Update: {
          agendada_para?: string | null
          atualizada_em?: string
          criada_em?: string
          delay_maximo?: number | null
          delay_mensagens?: number | null
          delay_minimo?: number | null
          delay_segundos?: number
          entregues?: number
          enviadas?: number
          erros?: number
          id?: string
          instancia_nome?: string | null
          instancia_token?: string | null
          instancia_whatsapp?: string | null
          mensagem?: string
          midia_bucket?: string | null
          midia_nome?: string | null
          midia_path?: string | null
          midia_url?: string | null
          nome?: string
          status?: string
          total_contatos?: number
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campanhas_instancia_whatsapp_fkey"
            columns: ["instancia_whatsapp"]
            isOneToOne: false
            referencedRelation: "instancias"
            referencedColumns: ["id"]
          },
        ]
      }
      configuracoes: {
        Row: {
          atualizado_em: string
          cor_primaria: string | null
          id: string
          instancia_uazapi: string | null
          logo_url: string | null
          nome_produto: string | null
          token_uazapi: string | null
          usuario_id: string
          webhook_cancelar: string | null
          webhook_criar: string | null
          webhook_pausar: string | null
          webhook_retomar: string | null
          webhook_status: string | null
        }
        Insert: {
          atualizado_em?: string
          cor_primaria?: string | null
          id?: string
          instancia_uazapi?: string | null
          logo_url?: string | null
          nome_produto?: string | null
          token_uazapi?: string | null
          usuario_id: string
          webhook_cancelar?: string | null
          webhook_criar?: string | null
          webhook_pausar?: string | null
          webhook_retomar?: string | null
          webhook_status?: string | null
        }
        Update: {
          atualizado_em?: string
          cor_primaria?: string | null
          id?: string
          instancia_uazapi?: string | null
          logo_url?: string | null
          nome_produto?: string | null
          token_uazapi?: string | null
          usuario_id?: string
          webhook_cancelar?: string | null
          webhook_criar?: string | null
          webhook_pausar?: string | null
          webhook_retomar?: string | null
          webhook_status?: string | null
        }
        Relationships: []
      }
      contatos_campanha: {
        Row: {
          atualizado_em: string
          campanha_id: string
          empresa: string | null
          id: string
          nome: string | null
          status: string
          telefone: string
        }
        Insert: {
          atualizado_em?: string
          campanha_id: string
          empresa?: string | null
          id?: string
          nome?: string | null
          status?: string
          telefone: string
        }
        Update: {
          atualizado_em?: string
          campanha_id?: string
          empresa?: string | null
          id?: string
          nome?: string | null
          status?: string
          telefone?: string
        }
        Relationships: [
          {
            foreignKeyName: "contatos_campanha_campanha_id_fkey"
            columns: ["campanha_id"]
            isOneToOne: false
            referencedRelation: "campanhas"
            referencedColumns: ["id"]
          },
        ]
      }
      instancias: {
        Row: {
          atualizada_em: string
          criada_em: string
          id: string
          instancia: string
          nome: string
          status: string
          token: string
          usuario_id: string
        }
        Insert: {
          atualizada_em?: string
          criada_em?: string
          id?: string
          instancia: string
          nome: string
          status?: string
          token: string
          usuario_id: string
        }
        Update: {
          atualizada_em?: string
          criada_em?: string
          id?: string
          instancia?: string
          nome?: string
          status?: string
          token?: string
          usuario_id?: string
        }
        Relationships: []
      }
      leads: {
        Row: {
          atualizado_em: string
          empresa: string | null
          id: string
          importado_em: string
          nome: string | null
          notas: string | null
          pasta_id: string | null
          telefone: string
          usuario_id: string
        }
        Insert: {
          atualizado_em?: string
          empresa?: string | null
          id?: string
          importado_em?: string
          nome?: string | null
          notas?: string | null
          pasta_id?: string | null
          telefone: string
          usuario_id: string
        }
        Update: {
          atualizado_em?: string
          empresa?: string | null
          id?: string
          importado_em?: string
          nome?: string | null
          notas?: string | null
          pasta_id?: string | null
          telefone?: string
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_pasta_id_fkey"
            columns: ["pasta_id"]
            isOneToOne: false
            referencedRelation: "pastas"
            referencedColumns: ["id"]
          },
        ]
      }
      leads_tags: {
        Row: {
          id: string
          lead_id: string
          tag: string
        }
        Insert: {
          id?: string
          lead_id: string
          tag: string
        }
        Update: {
          id?: string
          lead_id?: string
          tag?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_tags_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      pastas: {
        Row: {
          codigo: string | null
          criada_em: string
          id: string
          nome: string
          usuario_id: string
        }
        Insert: {
          codigo?: string | null
          criada_em?: string
          id?: string
          nome: string
          usuario_id: string
        }
        Update: {
          codigo?: string | null
          criada_em?: string
          id?: string
          nome?: string
          usuario_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          criado_em: string
          email: string | null
          id: string
          nome: string | null
        }
        Insert: {
          criado_em?: string
          email?: string | null
          id: string
          nome?: string | null
        }
        Update: {
          criado_em?: string
          email?: string | null
          id?: string
          nome?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      gerar_codigo_pasta: { Args: { p_usuario_id: string }; Returns: string }
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
