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
    PostgrestVersion: "14.15"
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
      addresses: {
        Row: {
          city: string
          country_code: string
          created_at: string
          id: string
          is_default_billing: boolean
          is_default_shipping: boolean
          label: string | null
          line1: string
          line2: string | null
          phone: string
          postal_code: string | null
          recipient_name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          city: string
          country_code?: string
          created_at?: string
          id?: string
          is_default_billing?: boolean
          is_default_shipping?: boolean
          label?: string | null
          line1: string
          line2?: string | null
          phone: string
          postal_code?: string | null
          recipient_name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          city?: string
          country_code?: string
          created_at?: string
          id?: string
          is_default_billing?: boolean
          is_default_shipping?: boolean
          label?: string | null
          line1?: string
          line2?: string | null
          phone?: string
          postal_code?: string | null
          recipient_name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "addresses_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "addresses_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_admin_customers"
            referencedColumns: ["id"]
          },
        ]
      }
      article_health_goals: {
        Row: {
          article_id: string
          goal_id: string
        }
        Insert: {
          article_id: string
          goal_id: string
        }
        Update: {
          article_id?: string
          goal_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "article_health_goals_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "article_health_goals_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "health_goals"
            referencedColumns: ["id"]
          },
        ]
      }
      article_ingredients: {
        Row: {
          article_id: string
          ingredient_id: string
        }
        Insert: {
          article_id: string
          ingredient_id: string
        }
        Update: {
          article_id?: string
          ingredient_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "article_ingredients_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "article_ingredients_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
        ]
      }
      article_products: {
        Row: {
          article_id: string
          product_id: string
        }
        Insert: {
          article_id: string
          product_id: string
        }
        Update: {
          article_id?: string
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "article_products_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "article_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "article_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_admin_inventory"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "article_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_low_stock"
            referencedColumns: ["product_id"]
          },
        ]
      }
      articles: {
        Row: {
          author_id: string | null
          body: Json
          cover_path: string | null
          created_at: string
          deleted_at: string | null
          excerpt: Json
          id: string
          published_at: string | null
          reading_minutes: number | null
          seo: Json
          slug: string
          status: Database["public"]["Enums"]["article_status"]
          tags: string[]
          title: Json
          type: Database["public"]["Enums"]["article_type"]
          updated_at: string
        }
        Insert: {
          author_id?: string | null
          body?: Json
          cover_path?: string | null
          created_at?: string
          deleted_at?: string | null
          excerpt?: Json
          id?: string
          published_at?: string | null
          reading_minutes?: number | null
          seo?: Json
          slug: string
          status?: Database["public"]["Enums"]["article_status"]
          tags?: string[]
          title: Json
          type?: Database["public"]["Enums"]["article_type"]
          updated_at?: string
        }
        Update: {
          author_id?: string | null
          body?: Json
          cover_path?: string | null
          created_at?: string
          deleted_at?: string | null
          excerpt?: Json
          id?: string
          published_at?: string | null
          reading_minutes?: number | null
          seo?: Json
          slug?: string
          status?: Database["public"]["Enums"]["article_status"]
          tags?: string[]
          title?: Json
          type?: Database["public"]["Enums"]["article_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "articles_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "articles_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "v_admin_customers"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          actor_role: Database["public"]["Enums"]["user_role"] | null
          after: Json | null
          before: Json | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          ip: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_role?: Database["public"]["Enums"]["user_role"] | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          ip?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_role?: Database["public"]["Enums"]["user_role"] | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          ip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "v_admin_customers"
            referencedColumns: ["id"]
          },
        ]
      }
      banners: {
        Row: {
          created_at: string
          cta_href: string | null
          cta_label: Json
          ends_at: string | null
          id: string
          image_path: string | null
          is_active: boolean
          placement: string
          position: number
          starts_at: string | null
          subtitle: Json
          title: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          cta_href?: string | null
          cta_label?: Json
          ends_at?: string | null
          id?: string
          image_path?: string | null
          is_active?: boolean
          placement: string
          position?: number
          starts_at?: string | null
          subtitle?: Json
          title?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          cta_href?: string | null
          cta_label?: Json
          ends_at?: string | null
          id?: string
          image_path?: string | null
          is_active?: boolean
          placement?: string
          position?: number
          starts_at?: string | null
          subtitle?: Json
          title?: Json
          updated_at?: string
        }
        Relationships: []
      }
      brands: {
        Row: {
          banner_path: string | null
          country_code: string | null
          created_at: string
          deleted_at: string | null
          description: Json
          id: string
          is_active: boolean
          logo_path: string | null
          name: string
          seo: Json
          slug: string
          sort_order: number
          updated_at: string
          website_url: string | null
        }
        Insert: {
          banner_path?: string | null
          country_code?: string | null
          created_at?: string
          deleted_at?: string | null
          description?: Json
          id?: string
          is_active?: boolean
          logo_path?: string | null
          name: string
          seo?: Json
          slug: string
          sort_order?: number
          updated_at?: string
          website_url?: string | null
        }
        Update: {
          banner_path?: string | null
          country_code?: string | null
          created_at?: string
          deleted_at?: string | null
          description?: Json
          id?: string
          is_active?: boolean
          logo_path?: string | null
          name?: string
          seo?: Json
          slug?: string
          sort_order?: number
          updated_at?: string
          website_url?: string | null
        }
        Relationships: []
      }
      cart_items: {
        Row: {
          cart_id: string
          created_at: string
          id: string
          quantity: number
          subscribe_frequency_days: number | null
          updated_at: string
          variant_id: string
        }
        Insert: {
          cart_id: string
          created_at?: string
          id?: string
          quantity: number
          subscribe_frequency_days?: number | null
          updated_at?: string
          variant_id: string
        }
        Update: {
          cart_id?: string
          created_at?: string
          id?: string
          quantity?: number
          subscribe_frequency_days?: number | null
          updated_at?: string
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cart_items_cart_id_fkey"
            columns: ["cart_id"]
            isOneToOne: false
            referencedRelation: "carts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cart_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      carts: {
        Row: {
          anon_token: string | null
          created_at: string
          currency: string
          id: string
          status: Database["public"]["Enums"]["cart_status"]
          updated_at: string
          user_id: string | null
        }
        Insert: {
          anon_token?: string | null
          created_at?: string
          currency?: string
          id?: string
          status?: Database["public"]["Enums"]["cart_status"]
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          anon_token?: string | null
          created_at?: string
          currency?: string
          id?: string
          status?: Database["public"]["Enums"]["cart_status"]
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "carts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "carts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_admin_customers"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          created_at: string
          deleted_at: string | null
          description: Json
          icon: string | null
          id: string
          image_path: string | null
          is_active: boolean
          name: Json
          parent_id: string | null
          seo: Json
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          description?: Json
          icon?: string | null
          id?: string
          image_path?: string | null
          is_active?: boolean
          name: Json
          parent_id?: string | null
          seo?: Json
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          description?: Json
          icon?: string | null
          id?: string
          image_path?: string | null
          is_active?: boolean
          name?: Json
          parent_id?: string | null
          seo?: Json
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      certifications: {
        Row: {
          created_at: string
          icon_path: string | null
          id: string
          name: Json
          slug: string
        }
        Insert: {
          created_at?: string
          icon_path?: string | null
          id?: string
          name: Json
          slug: string
        }
        Update: {
          created_at?: string
          icon_path?: string | null
          id?: string
          name?: Json
          slug?: string
        }
        Relationships: []
      }
      contact_messages: {
        Row: {
          body: string
          created_at: string
          email: string
          id: string
          name: string
          replied_at: string | null
          replied_by: string | null
          status: string
          subject: string | null
          updated_at: string
        }
        Insert: {
          body: string
          created_at?: string
          email: string
          id?: string
          name: string
          replied_at?: string | null
          replied_by?: string | null
          status?: string
          subject?: string | null
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          email?: string
          id?: string
          name?: string
          replied_at?: string | null
          replied_by?: string | null
          status?: string
          subject?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_messages_replied_by_fkey"
            columns: ["replied_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_messages_replied_by_fkey"
            columns: ["replied_by"]
            isOneToOne: false
            referencedRelation: "v_admin_customers"
            referencedColumns: ["id"]
          },
        ]
      }
      coupon_redemptions: {
        Row: {
          coupon_id: string
          created_at: string
          id: string
          order_id: string
          user_id: string | null
        }
        Insert: {
          coupon_id: string
          created_at?: string
          id?: string
          order_id: string
          user_id?: string | null
        }
        Update: {
          coupon_id?: string
          created_at?: string
          id?: string
          order_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "coupon_redemptions_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "coupons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coupon_redemptions_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "v_admin_coupons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coupon_redemptions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coupon_redemptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coupon_redemptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_admin_customers"
            referencedColumns: ["id"]
          },
        ]
      }
      coupons: {
        Row: {
          code: string
          created_at: string
          ends_at: string | null
          id: string
          is_active: boolean
          is_system: boolean
          max_uses: number | null
          max_uses_per_user: number | null
          min_subtotal_cents: number | null
          note: string | null
          starts_at: string | null
          type: Database["public"]["Enums"]["discount_type"]
          updated_at: string
          value: number
        }
        Insert: {
          code: string
          created_at?: string
          ends_at?: string | null
          id?: string
          is_active?: boolean
          is_system?: boolean
          max_uses?: number | null
          max_uses_per_user?: number | null
          min_subtotal_cents?: number | null
          note?: string | null
          starts_at?: string | null
          type: Database["public"]["Enums"]["discount_type"]
          updated_at?: string
          value?: number
        }
        Update: {
          code?: string
          created_at?: string
          ends_at?: string | null
          id?: string
          is_active?: boolean
          is_system?: boolean
          max_uses?: number | null
          max_uses_per_user?: number | null
          min_subtotal_cents?: number | null
          note?: string | null
          starts_at?: string | null
          type?: Database["public"]["Enums"]["discount_type"]
          updated_at?: string
          value?: number
        }
        Relationships: []
      }
      email_log: {
        Row: {
          created_at: string
          error: string | null
          id: string
          order_id: string | null
          provider_id: string | null
          status: string
          subject: string | null
          template: string
          to_email: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          id?: string
          order_id?: string | null
          provider_id?: string | null
          status?: string
          subject?: string | null
          template: string
          to_email: string
        }
        Update: {
          created_at?: string
          error?: string | null
          id?: string
          order_id?: string | null
          provider_id?: string | null
          status?: string
          subject?: string | null
          template?: string
          to_email?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_log_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      faqs: {
        Row: {
          answer: Json
          category: string
          created_at: string
          id: string
          is_active: boolean
          position: number
          question: Json
          updated_at: string
        }
        Insert: {
          answer: Json
          category?: string
          created_at?: string
          id?: string
          is_active?: boolean
          position?: number
          question: Json
          updated_at?: string
        }
        Update: {
          answer?: Json
          category?: string
          created_at?: string
          id?: string
          is_active?: boolean
          position?: number
          question?: Json
          updated_at?: string
        }
        Relationships: []
      }
      health_goals: {
        Row: {
          created_at: string
          description: Json
          icon: string | null
          id: string
          image_path: string | null
          is_active: boolean
          name: Json
          seo: Json
          slug: string
          sort_order: number
          tagline: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: Json
          icon?: string | null
          id?: string
          image_path?: string | null
          is_active?: boolean
          name: Json
          seo?: Json
          slug: string
          sort_order?: number
          tagline?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: Json
          icon?: string | null
          id?: string
          image_path?: string | null
          is_active?: boolean
          name?: Json
          seo?: Json
          slug?: string
          sort_order?: number
          tagline?: Json
          updated_at?: string
        }
        Relationships: []
      }
      ingredients: {
        Row: {
          benefits: Json
          category: string | null
          created_at: string
          dosage_notes: Json
          evidence: Database["public"]["Enums"]["evidence_level"] | null
          id: string
          is_active: boolean
          name: Json
          other_names: string[]
          safety_notes: Json
          seo: Json
          slug: string
          summary: Json
          updated_at: string
        }
        Insert: {
          benefits?: Json
          category?: string | null
          created_at?: string
          dosage_notes?: Json
          evidence?: Database["public"]["Enums"]["evidence_level"] | null
          id?: string
          is_active?: boolean
          name: Json
          other_names?: string[]
          safety_notes?: Json
          seo?: Json
          slug: string
          summary?: Json
          updated_at?: string
        }
        Update: {
          benefits?: Json
          category?: string | null
          created_at?: string
          dosage_notes?: Json
          evidence?: Database["public"]["Enums"]["evidence_level"] | null
          id?: string
          is_active?: boolean
          name?: Json
          other_names?: string[]
          safety_notes?: Json
          seo?: Json
          slug?: string
          summary?: Json
          updated_at?: string
        }
        Relationships: []
      }
      inventory_levels: {
        Row: {
          low_stock_threshold: number
          on_hand: number
          updated_at: string
          variant_id: string
          warehouse_id: string
        }
        Insert: {
          low_stock_threshold?: number
          on_hand?: number
          updated_at?: string
          variant_id: string
          warehouse_id: string
        }
        Update: {
          low_stock_threshold?: number
          on_hand?: number
          updated_at?: string
          variant_id?: string
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_levels_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_levels_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      lab_reports: {
        Row: {
          batch_number: string | null
          created_at: string
          expires_at: string | null
          file_path: string
          id: string
          is_public: boolean
          issued_at: string | null
          product_id: string
          title: string
        }
        Insert: {
          batch_number?: string | null
          created_at?: string
          expires_at?: string | null
          file_path: string
          id?: string
          is_public?: boolean
          issued_at?: string | null
          product_id: string
          title: string
        }
        Update: {
          batch_number?: string | null
          created_at?: string
          expires_at?: string | null
          file_path?: string
          id?: string
          is_public?: boolean
          issued_at?: string | null
          product_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "lab_reports_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_reports_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_admin_inventory"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "lab_reports_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_low_stock"
            referencedColumns: ["product_id"]
          },
        ]
      }
      loyalty_transactions: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          note: string | null
          order_id: string | null
          points: number
          reason: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          order_id?: string | null
          points: number
          reason: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          order_id?: string | null
          points?: number
          reason?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_transactions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_transactions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_admin_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_transactions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_admin_customers"
            referencedColumns: ["id"]
          },
        ]
      }
      newsletter_subscribers: {
        Row: {
          confirm_token: string | null
          confirmed_at: string | null
          created_at: string
          email: string
          id: string
          locale: string
          source: string | null
          unsubscribe_token: string
          unsubscribed_at: string | null
        }
        Insert: {
          confirm_token?: string | null
          confirmed_at?: string | null
          created_at?: string
          email: string
          id?: string
          locale?: string
          source?: string | null
          unsubscribe_token?: string
          unsubscribed_at?: string | null
        }
        Update: {
          confirm_token?: string | null
          confirmed_at?: string | null
          created_at?: string
          email?: string
          id?: string
          locale?: string
          source?: string | null
          unsubscribe_token?: string
          unsubscribed_at?: string | null
        }
        Relationships: []
      }
      order_events: {
        Row: {
          created_at: string
          created_by: string | null
          data: Json
          id: string
          is_customer_visible: boolean
          message: string | null
          order_id: string
          type: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          data?: Json
          id?: string
          is_customer_visible?: boolean
          message?: string | null
          order_id: string
          type: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          data?: Json
          id?: string
          is_customer_visible?: boolean
          message?: string | null
          order_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_admin_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          created_at: string
          id: string
          image_path: string | null
          name_snapshot: string
          order_id: string
          product_id: string | null
          quantity: number
          sku: string
          total_cents: number
          unit_price_cents: number
          variant_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          image_path?: string | null
          name_snapshot: string
          order_id: string
          product_id?: string | null
          quantity: number
          sku: string
          total_cents: number
          unit_price_cents: number
          variant_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          image_path?: string | null
          name_snapshot?: string
          order_id?: string
          product_id?: string | null
          quantity?: number
          sku?: string
          total_cents?: number
          unit_price_cents?: number
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_admin_inventory"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_low_stock"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "order_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          access_token: string
          admin_note: string | null
          billing_address: Json
          cancelled_at: string | null
          coupon_code: string | null
          coupon_id: string | null
          created_at: string
          currency: string
          customer_note: string | null
          delivered_at: string | null
          discount_cents: number
          email: string
          id: string
          locale: string
          order_number: string
          payment_status: Database["public"]["Enums"]["payment_status"]
          phone: string
          placed_at: string
          shipping_address: Json
          shipping_cents: number
          shipping_method: Json | null
          source: string
          status: Database["public"]["Enums"]["order_status"]
          subscription_id: string | null
          subtotal_cents: number
          tax_cents: number
          total_cents: number
          updated_at: string
          user_id: string | null
        }
        Insert: {
          access_token?: string
          admin_note?: string | null
          billing_address: Json
          cancelled_at?: string | null
          coupon_code?: string | null
          coupon_id?: string | null
          created_at?: string
          currency?: string
          customer_note?: string | null
          delivered_at?: string | null
          discount_cents?: number
          email: string
          id?: string
          locale?: string
          order_number?: string
          payment_status?: Database["public"]["Enums"]["payment_status"]
          phone: string
          placed_at?: string
          shipping_address: Json
          shipping_cents?: number
          shipping_method?: Json | null
          source?: string
          status?: Database["public"]["Enums"]["order_status"]
          subscription_id?: string | null
          subtotal_cents: number
          tax_cents?: number
          total_cents: number
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          access_token?: string
          admin_note?: string | null
          billing_address?: Json
          cancelled_at?: string | null
          coupon_code?: string | null
          coupon_id?: string | null
          created_at?: string
          currency?: string
          customer_note?: string | null
          delivered_at?: string | null
          discount_cents?: number
          email?: string
          id?: string
          locale?: string
          order_number?: string
          payment_status?: Database["public"]["Enums"]["payment_status"]
          phone?: string
          placed_at?: string
          shipping_address?: Json
          shipping_cents?: number
          shipping_method?: Json | null
          source?: string
          status?: Database["public"]["Enums"]["order_status"]
          subscription_id?: string | null
          subtotal_cents?: number
          tax_cents?: number
          total_cents?: number
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "coupons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "v_admin_coupons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_subscription_fk"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_subscription_fk"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "v_subscription_schedule"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_admin_customers"
            referencedColumns: ["id"]
          },
        ]
      }
      pages: {
        Row: {
          body: Json
          created_at: string
          id: string
          seo: Json
          slug: string
          status: Database["public"]["Enums"]["article_status"]
          title: Json
          updated_at: string
        }
        Insert: {
          body?: Json
          created_at?: string
          id?: string
          seo?: Json
          slug: string
          status?: Database["public"]["Enums"]["article_status"]
          title: Json
          updated_at?: string
        }
        Update: {
          body?: Json
          created_at?: string
          id?: string
          seo?: Json
          slug?: string
          status?: Database["public"]["Enums"]["article_status"]
          title?: Json
          updated_at?: string
        }
        Relationships: []
      }
      payments: {
        Row: {
          amount_cents: number
          created_at: string
          currency: string
          error: string | null
          id: string
          order_id: string
          provider: Database["public"]["Enums"]["payment_provider"]
          provider_ref: string | null
          raw: Json | null
          status: Database["public"]["Enums"]["payment_status"]
          updated_at: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          currency?: string
          error?: string | null
          id?: string
          order_id: string
          provider: Database["public"]["Enums"]["payment_provider"]
          provider_ref?: string | null
          raw?: Json | null
          status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          currency?: string
          error?: string | null
          id?: string
          order_id?: string
          provider?: Database["public"]["Enums"]["payment_provider"]
          provider_ref?: string | null
          raw?: Json | null
          status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      product_categories: {
        Row: {
          category_id: string
          is_primary: boolean
          product_id: string
        }
        Insert: {
          category_id: string
          is_primary?: boolean
          product_id: string
        }
        Update: {
          category_id?: string
          is_primary?: boolean
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_categories_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_categories_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_categories_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_admin_inventory"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_categories_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_low_stock"
            referencedColumns: ["product_id"]
          },
        ]
      }
      product_certifications: {
        Row: {
          certification_id: string
          product_id: string
        }
        Insert: {
          certification_id: string
          product_id: string
        }
        Update: {
          certification_id?: string
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_certifications_certification_id_fkey"
            columns: ["certification_id"]
            isOneToOne: false
            referencedRelation: "certifications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_certifications_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_certifications_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_admin_inventory"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_certifications_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_low_stock"
            referencedColumns: ["product_id"]
          },
        ]
      }
      product_health_goals: {
        Row: {
          goal_id: string
          product_id: string
        }
        Insert: {
          goal_id: string
          product_id: string
        }
        Update: {
          goal_id?: string
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_health_goals_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "health_goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_health_goals_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_health_goals_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_admin_inventory"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_health_goals_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_low_stock"
            referencedColumns: ["product_id"]
          },
        ]
      }
      product_images: {
        Row: {
          alt: Json
          created_at: string
          id: string
          position: number
          product_id: string
          storage_path: string
        }
        Insert: {
          alt?: Json
          created_at?: string
          id?: string
          position?: number
          product_id: string
          storage_path: string
        }
        Update: {
          alt?: Json
          created_at?: string
          id?: string
          position?: number
          product_id?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_images_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_images_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_admin_inventory"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_images_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_low_stock"
            referencedColumns: ["product_id"]
          },
        ]
      }
      product_ingredients: {
        Row: {
          amount: number | null
          ingredient_id: string
          nrv_pct: number | null
          per_serving: boolean
          position: number
          product_id: string
          unit: string | null
        }
        Insert: {
          amount?: number | null
          ingredient_id: string
          nrv_pct?: number | null
          per_serving?: boolean
          position?: number
          product_id: string
          unit?: string | null
        }
        Update: {
          amount?: number | null
          ingredient_id?: string
          nrv_pct?: number | null
          per_serving?: boolean
          position?: number
          product_id?: string
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_ingredients_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_ingredients_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_ingredients_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_admin_inventory"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_ingredients_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_low_stock"
            referencedColumns: ["product_id"]
          },
        ]
      }
      product_relations: {
        Row: {
          kind: string
          product_id: string
          related_product_id: string
        }
        Insert: {
          kind?: string
          product_id: string
          related_product_id: string
        }
        Update: {
          kind?: string
          product_id?: string
          related_product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_relations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_relations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_admin_inventory"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_relations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_low_stock"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_relations_related_product_id_fkey"
            columns: ["related_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_relations_related_product_id_fkey"
            columns: ["related_product_id"]
            isOneToOne: false
            referencedRelation: "v_admin_inventory"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_relations_related_product_id_fkey"
            columns: ["related_product_id"]
            isOneToOne: false
            referencedRelation: "v_low_stock"
            referencedColumns: ["product_id"]
          },
        ]
      }
      product_variant_costs: {
        Row: {
          cost_cents: number
          currency: string
          note: string | null
          updated_at: string
          updated_by: string | null
          variant_id: string
        }
        Insert: {
          cost_cents: number
          currency?: string
          note?: string | null
          updated_at?: string
          updated_by?: string | null
          variant_id: string
        }
        Update: {
          cost_cents?: number
          currency?: string
          note?: string | null
          updated_at?: string
          updated_by?: string | null
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_variant_costs_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_variant_costs_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "v_admin_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_variant_costs_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: true
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      product_variants: {
        Row: {
          barcode: string | null
          compare_at_price_cents: number | null
          created_at: string
          currency: string
          id: string
          is_active: boolean
          is_default: boolean
          name: Json
          options: Json
          position: number
          price_cents: number
          product_id: string
          sku: string
          updated_at: string
          weight_grams: number | null
        }
        Insert: {
          barcode?: string | null
          compare_at_price_cents?: number | null
          created_at?: string
          currency?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          name: Json
          options?: Json
          position?: number
          price_cents: number
          product_id: string
          sku: string
          updated_at?: string
          weight_grams?: number | null
        }
        Update: {
          barcode?: string | null
          compare_at_price_cents?: number | null
          created_at?: string
          currency?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          name?: Json
          options?: Json
          position?: number
          price_cents?: number
          product_id?: string
          sku?: string
          updated_at?: string
          weight_grams?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_admin_inventory"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_low_stock"
            referencedColumns: ["product_id"]
          },
        ]
      }
      products: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          brand_id: string
          created_at: string
          deleted_at: string | null
          description: Json
          dietary_tags: string[]
          form: Database["public"]["Enums"]["product_form"] | null
          how_to_use: Json
          id: string
          is_featured: boolean
          name: Json
          published_at: string | null
          rating_avg: number
          rating_count: number
          search_text: unknown
          seo: Json
          serving_size: string | null
          slug: string
          status: Database["public"]["Enums"]["product_status"]
          subtitle: Json
          updated_at: string
          warnings: Json
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          brand_id: string
          created_at?: string
          deleted_at?: string | null
          description?: Json
          dietary_tags?: string[]
          form?: Database["public"]["Enums"]["product_form"] | null
          how_to_use?: Json
          id?: string
          is_featured?: boolean
          name: Json
          published_at?: string | null
          rating_avg?: number
          rating_count?: number
          search_text?: unknown
          seo?: Json
          serving_size?: string | null
          slug: string
          status?: Database["public"]["Enums"]["product_status"]
          subtitle?: Json
          updated_at?: string
          warnings?: Json
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          brand_id?: string
          created_at?: string
          deleted_at?: string | null
          description?: Json
          dietary_tags?: string[]
          form?: Database["public"]["Enums"]["product_form"] | null
          how_to_use?: Json
          id?: string
          is_featured?: boolean
          name?: Json
          published_at?: string | null
          rating_avg?: number
          rating_count?: number
          search_text?: unknown
          seo?: Json
          serving_size?: string | null
          slug?: string
          status?: Database["public"]["Enums"]["product_status"]
          subtitle?: Json
          updated_at?: string
          warnings?: Json
        }
        Relationships: [
          {
            foreignKeyName: "products_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "v_admin_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          deleted_at: string | null
          email: string
          full_name: string | null
          id: string
          loyalty_points: number
          marketing_opt_in: boolean
          phone: string | null
          preferred_locale: string
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          deleted_at?: string | null
          email: string
          full_name?: string | null
          id: string
          loyalty_points?: number
          marketing_opt_in?: boolean
          phone?: string | null
          preferred_locale?: string
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          deleted_at?: string | null
          email?: string
          full_name?: string | null
          id?: string
          loyalty_points?: number
          marketing_opt_in?: boolean
          phone?: string | null
          preferred_locale?: string
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: []
      }
      quiz_submissions: {
        Row: {
          answers: Json
          created_at: string
          id: string
          recommended_product_ids: string[]
          user_id: string | null
        }
        Insert: {
          answers: Json
          created_at?: string
          id?: string
          recommended_product_ids?: string[]
          user_id?: string | null
        }
        Update: {
          answers?: Json
          created_at?: string
          id?: string
          recommended_product_ids?: string[]
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quiz_submissions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quiz_submissions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_admin_customers"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limits: {
        Row: {
          count: number
          key: string
          window_start: string
        }
        Insert: {
          count?: number
          key: string
          window_start: string
        }
        Update: {
          count?: number
          key?: string
          window_start?: string
        }
        Relationships: []
      }
      refunds: {
        Row: {
          amount_cents: number
          created_at: string
          created_by: string | null
          id: string
          order_id: string
          payment_id: string | null
          reason: string
          restock: boolean
        }
        Insert: {
          amount_cents: number
          created_at?: string
          created_by?: string | null
          id?: string
          order_id: string
          payment_id?: string | null
          reason: string
          restock?: boolean
        }
        Update: {
          amount_cents?: number
          created_at?: string
          created_by?: string | null
          id?: string
          order_id?: string
          payment_id?: string | null
          reason?: string
          restock?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "refunds_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_admin_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      review_votes: {
        Row: {
          created_at: string
          review_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          review_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          review_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_votes_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "reviews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_votes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_votes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_admin_customers"
            referencedColumns: ["id"]
          },
        ]
      }
      reviews: {
        Row: {
          admin_reply: string | null
          author_name: string
          body: string | null
          created_at: string
          helpful_count: number
          id: string
          order_id: string | null
          product_id: string
          rating: number
          rejection_reason: string | null
          status: Database["public"]["Enums"]["review_status"]
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          admin_reply?: string | null
          author_name: string
          body?: string | null
          created_at?: string
          helpful_count?: number
          id?: string
          order_id?: string | null
          product_id: string
          rating: number
          rejection_reason?: string | null
          status?: Database["public"]["Enums"]["review_status"]
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          admin_reply?: string | null
          author_name?: string
          body?: string | null
          created_at?: string
          helpful_count?: number
          id?: string
          order_id?: string | null
          product_id?: string
          rating?: number
          rejection_reason?: string | null
          status?: Database["public"]["Enums"]["review_status"]
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reviews_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_admin_inventory"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "reviews_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_low_stock"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "reviews_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_admin_customers"
            referencedColumns: ["id"]
          },
        ]
      }
      settings: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "v_admin_customers"
            referencedColumns: ["id"]
          },
        ]
      }
      shipments: {
        Row: {
          carrier: string | null
          created_at: string
          delivered_at: string | null
          id: string
          order_id: string
          shipped_at: string | null
          status: string
          tracking_number: string | null
          tracking_url: string | null
          updated_at: string
        }
        Insert: {
          carrier?: string | null
          created_at?: string
          delivered_at?: string | null
          id?: string
          order_id: string
          shipped_at?: string | null
          status?: string
          tracking_number?: string | null
          tracking_url?: string | null
          updated_at?: string
        }
        Update: {
          carrier?: string | null
          created_at?: string
          delivered_at?: string | null
          id?: string
          order_id?: string
          shipped_at?: string | null
          status?: string
          tracking_number?: string | null
          tracking_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      shipping_methods: {
        Row: {
          countries: string[]
          created_at: string
          description: Json
          free_over_cents: number | null
          id: string
          is_active: boolean
          max_days: number
          min_days: number
          name: Json
          position: number
          price_cents: number
          updated_at: string
        }
        Insert: {
          countries?: string[]
          created_at?: string
          description?: Json
          free_over_cents?: number | null
          id?: string
          is_active?: boolean
          max_days?: number
          min_days?: number
          name: Json
          position?: number
          price_cents?: number
          updated_at?: string
        }
        Update: {
          countries?: string[]
          created_at?: string
          description?: Json
          free_over_cents?: number | null
          id?: string
          is_active?: boolean
          max_days?: number
          min_days?: number
          name?: Json
          position?: number
          price_cents?: number
          updated_at?: string
        }
        Relationships: []
      }
      stock_movements: {
        Row: {
          batch_number: string | null
          created_at: string
          created_by: string | null
          expiry_date: string | null
          id: string
          note: string | null
          quantity: number
          reference_id: string | null
          reference_type: string | null
          type: Database["public"]["Enums"]["stock_movement_type"]
          variant_id: string
          warehouse_id: string
        }
        Insert: {
          batch_number?: string | null
          created_at?: string
          created_by?: string | null
          expiry_date?: string | null
          id?: string
          note?: string | null
          quantity: number
          reference_id?: string | null
          reference_type?: string | null
          type: Database["public"]["Enums"]["stock_movement_type"]
          variant_id: string
          warehouse_id: string
        }
        Update: {
          batch_number?: string | null
          created_at?: string
          created_by?: string | null
          expiry_date?: string | null
          id?: string
          note?: string | null
          quantity?: number
          reference_id?: string | null
          reference_type?: string | null
          type?: Database["public"]["Enums"]["stock_movement_type"]
          variant_id?: string
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_admin_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_action_tokens: {
        Row: {
          action: string
          created_at: string
          expires_at: string
          subscription_id: string
          token: string
          used_at: string | null
        }
        Insert: {
          action: string
          created_at?: string
          expires_at: string
          subscription_id: string
          token?: string
          used_at?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          expires_at?: string
          subscription_id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subscription_action_tokens_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_action_tokens_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "v_subscription_schedule"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_items: {
        Row: {
          id: string
          quantity: number
          subscription_id: string
          variant_id: string
        }
        Insert: {
          id?: string
          quantity: number
          subscription_id: string
          variant_id: string
        }
        Update: {
          id?: string
          quantity?: number
          subscription_id?: string
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_items_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_items_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "v_subscription_schedule"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          cancel_reason: string | null
          cancelled_at: string | null
          consecutive_failures: number
          created_at: string
          discount_pct: number
          frequency_days: number
          id: string
          next_run_at: string
          paused_until: string | null
          payment_provider: Database["public"]["Enums"]["payment_provider"]
          shipping_address: Json
          shipping_method_id: string | null
          status: Database["public"]["Enums"]["subscription_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          consecutive_failures?: number
          created_at?: string
          discount_pct?: number
          frequency_days: number
          id?: string
          next_run_at: string
          paused_until?: string | null
          payment_provider?: Database["public"]["Enums"]["payment_provider"]
          shipping_address: Json
          shipping_method_id?: string | null
          status?: Database["public"]["Enums"]["subscription_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          consecutive_failures?: number
          created_at?: string
          discount_pct?: number
          frequency_days?: number
          id?: string
          next_run_at?: string
          paused_until?: string | null
          payment_provider?: Database["public"]["Enums"]["payment_provider"]
          shipping_address?: Json
          shipping_method_id?: string | null
          status?: Database["public"]["Enums"]["subscription_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_shipping_method_id_fkey"
            columns: ["shipping_method_id"]
            isOneToOne: false
            referencedRelation: "shipping_methods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_admin_customers"
            referencedColumns: ["id"]
          },
        ]
      }
      warehouses: {
        Row: {
          address: Json
          code: string
          created_at: string
          id: string
          is_default: boolean
          name: string
          updated_at: string
        }
        Insert: {
          address?: Json
          code: string
          created_at?: string
          id?: string
          is_default?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          address?: Json
          code?: string
          created_at?: string
          id?: string
          is_default?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      wishlist_items: {
        Row: {
          created_at: string
          product_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          product_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          product_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wishlist_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wishlist_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_admin_inventory"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "wishlist_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_low_stock"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "wishlist_items_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wishlist_items_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_admin_customers"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      v_admin_coupons: {
        Row: {
          code: string | null
          created_at: string | null
          ends_at: string | null
          id: string | null
          is_active: boolean | null
          is_system: boolean | null
          last_redeemed_at: string | null
          max_uses: number | null
          max_uses_per_user: number | null
          min_subtotal_cents: number | null
          note: string | null
          redemption_count: number | null
          starts_at: string | null
          type: Database["public"]["Enums"]["discount_type"] | null
          updated_at: string | null
          value: number | null
        }
        Relationships: []
      }
      v_admin_customers: {
        Row: {
          active_subscriptions: number | null
          created_at: string | null
          deleted_at: string | null
          email: string | null
          full_name: string | null
          id: string | null
          last_order_at: string | null
          lifetime_cents: number | null
          loyalty_points: number | null
          marketing_opt_in: boolean | null
          orders_count: number | null
          phone: string | null
          role: Database["public"]["Enums"]["user_role"] | null
        }
        Relationships: []
      }
      v_admin_daily_sales: {
        Row: {
          day: string | null
          orders: number | null
          revenue_cents: number | null
        }
        Relationships: []
      }
      v_admin_inventory: {
        Row: {
          low_stock_threshold: number | null
          on_hand: number | null
          product_id: string | null
          product_name: Json | null
          product_slug: string | null
          product_status: Database["public"]["Enums"]["product_status"] | null
          sku: string | null
          stock_status: string | null
          updated_at: string | null
          variant_id: string | null
          variant_name: Json | null
          warehouse_id: string | null
          warehouse_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_levels_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_levels_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      v_low_stock: {
        Row: {
          low_stock_threshold: number | null
          on_hand: number | null
          product_id: string | null
          product_name: string | null
          sku: string | null
          variant_id: string | null
          warehouse_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_levels_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_levels_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      v_product_stock: {
        Row: {
          is_available: boolean | null
          stock_status: string | null
          variant_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_levels_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      v_stock_ledger_drift: {
        Row: {
          drift: number | null
          ledger_sum: number | null
          on_hand: number | null
          variant_id: string | null
          warehouse_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_levels_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_levels_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      v_subscription_schedule: {
        Row: {
          consecutive_failures: number | null
          frequency_days: number | null
          id: string | null
          is_due: boolean | null
          is_runnable: boolean | null
          needs_notice: boolean | null
          next_run_at: string | null
          paused_until: string | null
          status: Database["public"]["Enums"]["subscription_status"] | null
          user_id: string | null
        }
        Insert: {
          consecutive_failures?: number | null
          frequency_days?: number | null
          id?: string | null
          is_due?: never
          is_runnable?: never
          needs_notice?: never
          next_run_at?: string | null
          paused_until?: string | null
          status?: Database["public"]["Enums"]["subscription_status"] | null
          user_id?: string | null
        }
        Update: {
          consecutive_failures?: number | null
          frequency_days?: number | null
          id?: string | null
          is_due?: never
          is_runnable?: never
          needs_notice?: never
          next_run_at?: string | null
          paused_until?: string | null
          status?: Database["public"]["Enums"]["subscription_status"] | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_admin_customers"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      admin_adjust_loyalty: {
        Args: { p_note?: string; p_points: number; p_user_id: string }
        Returns: Json
      }
      admin_anonymize_customer: { Args: { p_user_id: string }; Returns: Json }
      apply_stock_movement: {
        Args: {
          p_batch_number?: string
          p_expiry_date?: string
          p_note?: string
          p_quantity: number
          p_reference_id?: string
          p_reference_type?: string
          p_type: Database["public"]["Enums"]["stock_movement_type"]
          p_variant_id: string
          p_warehouse_id: string
        }
        Returns: undefined
      }
      check_rate_limit: {
        Args: { p_key: string; p_max: number; p_window: string }
        Returns: boolean
      }
      checkout_create_order: {
        Args: {
          p_billing_address: Json
          p_cart_id: string
          p_coupon_code?: string
          p_customer_note?: string
          p_email: string
          p_locale?: string
          p_payment_provider: Database["public"]["Enums"]["payment_provider"]
          p_phone: string
          p_shipping_address: Json
          p_shipping_method_id: string
        }
        Returns: Json
      }
      claim_due_subscription: {
        Args: { p_subscription_id: string }
        Returns: Json
      }
      contact_submit: {
        Args: {
          p_body: string
          p_email: string
          p_name: string
          p_subject: string
        }
        Returns: string
      }
      generate_access_token: { Args: never; Returns: string }
      generate_order_number: { Args: never; Returns: string }
      has_any_role: {
        Args: { roles: Database["public"]["Enums"]["user_role"][] }
        Returns: boolean
      }
      is_admin: { Args: never; Returns: boolean }
      is_service_role: { Args: never; Returns: boolean }
      is_staff: { Args: never; Returns: boolean }
      list_public_coupons: {
        Args: never
        Returns: {
          code: string
          ends_at: string
          min_subtotal_cents: number
          type: Database["public"]["Enums"]["discount_type"]
          value: number
        }[]
      }
      log_audit: {
        Args: {
          p_action: string
          p_after?: Json
          p_before?: Json
          p_entity_id?: string
          p_entity_type: string
          p_ip?: string
        }
        Returns: undefined
      }
      newsletter_confirm: { Args: { p_token: string }; Returns: Json }
      newsletter_subscribe: {
        Args: { p_email: string; p_locale?: string; p_source?: string }
        Returns: Json
      }
      newsletter_unsubscribe: { Args: { p_token: string }; Returns: boolean }
      record_subscription_failure: {
        Args: { p_subscription_id: string }
        Returns: number
      }
      record_subscription_success: {
        Args: { p_subscription_id: string }
        Returns: undefined
      }
      redeem_loyalty_points: { Args: never; Returns: Json }
      resume_subscription: {
        Args: { p_subscription_id: string }
        Returns: boolean
      }
      search_products: {
        Args: {
          p_brand_slugs?: string[]
          p_category_slugs?: string[]
          p_dietary_tags?: string[]
          p_forms?: Database["public"]["Enums"]["product_form"][]
          p_goal_slugs?: string[]
          p_in_stock_only?: boolean
          p_ingredient_slugs?: string[]
          p_limit?: number
          p_max_price_cents?: number
          p_min_price_cents?: number
          p_min_rating?: number
          p_offset?: number
          p_on_sale_only?: boolean
          p_query?: string
          p_sort?: string
        }
        Returns: {
          brand_id: string
          brand_name: string
          brand_slug: string
          compare_at_price_cents: number
          dietary_tags: string[]
          form: Database["public"]["Enums"]["product_form"]
          image_path: string
          in_stock: boolean
          is_featured: boolean
          name: Json
          price_cents: number
          product_id: string
          published_at: string
          rating_avg: number
          rating_count: number
          sku: string
          slug: string
          subtitle: Json
          total_count: number
          variant_id: string
        }[]
      }
      skip_subscription_cycle: {
        Args: { p_subscription_id: string }
        Returns: boolean
      }
      subscription_apply_token: { Args: { p_token: string }; Returns: Json }
      tables_without_rls: { Args: never; Returns: string[] }
    }
    Enums: {
      article_status: "draft" | "in_review" | "published" | "archived"
      article_type: "article" | "guide" | "recipe" | "research" | "news"
      cart_status: "active" | "converted" | "abandoned"
      discount_type: "percentage" | "fixed" | "free_shipping"
      evidence_level: "strong" | "moderate" | "emerging" | "traditional"
      order_status:
        | "pending"
        | "confirmed"
        | "processing"
        | "shipped"
        | "delivered"
        | "cancelled"
        | "refunded"
      payment_provider: "cod" | "bank_pos" | "stripe"
      payment_status:
        | "pending"
        | "paid"
        | "failed"
        | "refunded"
        | "partially_refunded"
      product_form:
        | "capsule"
        | "tablet"
        | "softgel"
        | "powder"
        | "liquid"
        | "gummy"
        | "bar"
        | "spray"
        | "sachet"
        | "other"
      product_status: "draft" | "pending_review" | "published" | "archived"
      review_status: "pending" | "approved" | "rejected"
      stock_movement_type:
        | "received"
        | "sale"
        | "cancel_restock"
        | "refund_restock"
        | "adjustment"
      subscription_status: "active" | "paused" | "cancelled"
      user_role:
        | "customer"
        | "support"
        | "product_manager"
        | "content_manager"
        | "warehouse_manager"
        | "compliance_manager"
        | "admin"
    }
    CompositeTypes: {
      checkout_line: {
        variant_id: string | null
        product_id: string | null
        quantity: number | null
        price_cents: number | null
        sku: string | null
        name_snapshot: string | null
        image_path: string | null
      }
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
    Enums: {
      article_status: ["draft", "in_review", "published", "archived"],
      article_type: ["article", "guide", "recipe", "research", "news"],
      cart_status: ["active", "converted", "abandoned"],
      discount_type: ["percentage", "fixed", "free_shipping"],
      evidence_level: ["strong", "moderate", "emerging", "traditional"],
      order_status: [
        "pending",
        "confirmed",
        "processing",
        "shipped",
        "delivered",
        "cancelled",
        "refunded",
      ],
      payment_provider: ["cod", "bank_pos", "stripe"],
      payment_status: [
        "pending",
        "paid",
        "failed",
        "refunded",
        "partially_refunded",
      ],
      product_form: [
        "capsule",
        "tablet",
        "softgel",
        "powder",
        "liquid",
        "gummy",
        "bar",
        "spray",
        "sachet",
        "other",
      ],
      product_status: ["draft", "pending_review", "published", "archived"],
      review_status: ["pending", "approved", "rejected"],
      stock_movement_type: [
        "received",
        "sale",
        "cancel_restock",
        "refund_restock",
        "adjustment",
      ],
      subscription_status: ["active", "paused", "cancelled"],
      user_role: [
        "customer",
        "support",
        "product_manager",
        "content_manager",
        "warehouse_manager",
        "compliance_manager",
        "admin",
      ],
    },
  },
} as const
