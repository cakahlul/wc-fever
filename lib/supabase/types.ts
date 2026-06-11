/**
 * Database types for the World Cup Fever 2026 schema (supabase/schema.sql).
 *
 * Normally regenerated with `supabase gen types typescript --project-id <id>`;
 * hand-maintained here so the app is fully typed without a live project at
 * build time. Keep in sync with supabase/schema.sql.
 */

export type MatchStage =
  | 'group'
  | 'r32'
  | 'r16'
  | 'qf'
  | 'sf'
  | 'third_place'
  | 'final';

export type MatchStatus = 'scheduled' | 'live' | 'finished';

export interface MatchEvent {
  minute: number;
  type: 'goal' | 'own_goal' | 'penalty' | 'yellow' | 'red' | 'second_yellow' | 'sub';
  team: 'home' | 'away';
  player?: string;
  detail?: string;
}

export interface Database {
  public: {
    Tables: {
      teams: {
        Row: {
          id: string;
          name: string;
          code: string;
          flag_emoji: string | null;
          group: string | null;
          fifa_rank: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          code: string;
          flag_emoji?: string | null;
          group?: string | null;
          fifa_rank?: number | null;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['teams']['Insert']>;
        Relationships: [];
      };
      matches: {
        Row: {
          id: string;
          match_number: number | null;
          stage: MatchStage;
          group: string | null;
          matchday: number | null;
          kickoff_utc: string | null;
          venue: string | null;
          city: string | null;
          home_team_id: string | null;
          away_team_id: string | null;
          home_slot: string | null;
          away_slot: string | null;
          status: MatchStatus;
          minute: number | null;
          home_score: number | null;
          away_score: number | null;
          events: MatchEvent[];
          updated_at: string;
        };
        Insert: {
          id?: string;
          match_number?: number | null;
          stage: MatchStage;
          group?: string | null;
          matchday?: number | null;
          kickoff_utc?: string | null;
          venue?: string | null;
          city?: string | null;
          home_team_id?: string | null;
          away_team_id?: string | null;
          home_slot?: string | null;
          away_slot?: string | null;
          status?: MatchStatus;
          minute?: number | null;
          home_score?: number | null;
          away_score?: number | null;
          events?: MatchEvent[];
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['matches']['Insert']>;
        Relationships: [];
      };
      players: {
        Row: {
          id: string;
          team_id: string;
          name: string;
          shirt_number: number | null;
          position: string | null;
          club: string | null;
          is_captain: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          team_id: string;
          name: string;
          shirt_number?: number | null;
          position?: string | null;
          club?: string | null;
          is_captain?: boolean;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['players']['Insert']>;
        Relationships: [];
      };
      lineups: {
        Row: {
          id: string;
          match_id: string;
          team_id: string;
          player_id: string | null;
          player_name: string;
          shirt_number: number | null;
          position: string | null;
          role: string;
          is_captain: boolean;
          formation: string | null;
          updated_at: string;
        };
        Insert: {
          id?: string;
          match_id: string;
          team_id: string;
          player_id?: string | null;
          player_name: string;
          shirt_number?: number | null;
          position?: string | null;
          role?: string;
          is_captain?: boolean;
          formation?: string | null;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['lineups']['Insert']>;
        Relationships: [];
      };
      match_reviews: {
        Row: {
          match_id: string;
          language: string;
          body: string;
          generated_at: string;
        };
        Insert: {
          match_id: string;
          language?: string;
          body: string;
          generated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['match_reviews']['Insert']>;
        Relationships: [];
      };
      simulations: {
        Row: {
          id: string;
          user_id: string | null;
          name: string;
          picks: Record<string, string>;
          champion_team_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          name: string;
          picks?: Record<string, string>;
          champion_team_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['simulations']['Insert']>;
        Relationships: [];
      };
    };
    Views: {
      v_standings: {
        Row: {
          team_id: string;
          name: string;
          code: string;
          flag_emoji: string | null;
          group: string;
          played: number;
          won: number;
          drawn: number;
          lost: number;
          gf: number;
          ga: number;
          gd: number;
          points: number;
          group_rank: number;
        };
        Relationships: [];
      };
      v_third_place: {
        Row: Database['public']['Views']['v_standings']['Row'] & {
          overall_rank: number;
        };
        Relationships: [];
      };
    };
    Functions: Record<string, never>;
    Enums: {
      match_stage: MatchStage;
      match_status: MatchStatus;
    };
    CompositeTypes: Record<string, never>;
  };
}

// Convenience row aliases used throughout the app.
export type Team = Database['public']['Tables']['teams']['Row'];
export type Match = Database['public']['Tables']['matches']['Row'];
export type Player = Database['public']['Tables']['players']['Row'];
export type LineupEntry = Database['public']['Tables']['lineups']['Row'];
export type MatchReview = Database['public']['Tables']['match_reviews']['Row'];
export type Simulation = Database['public']['Tables']['simulations']['Row'];
export type StandingRow = Database['public']['Views']['v_standings']['Row'];

/** A match joined with its (possibly unresolved) teams — the app's main shape. */
export interface MatchWithTeams extends Match {
  home_team: Team | null;
  away_team: Team | null;
}
