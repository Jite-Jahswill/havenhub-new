import type { AssistantIntent } from '../schemas/assistant.js';

export interface AssistantCard {
  title: string;
  subtitle: string | null;
  /** Relative path in the web app. */
  href: string;
  imageUrl: string | null;
  /** Short status or price label ("Refund completed", "₦250,000 / year"). */
  badge: string | null;
}

export interface AssistantReply {
  intent: AssistantIntent;
  text: string;
  cards: AssistantCard[];
  /** "See all results" and similar. */
  link: { label: string; href: string } | null;
  /** Follow-up questions offered as quick replies. */
  suggestions: string[];
  /** Show "Talk to a person". */
  offerHandoff: boolean;
  /** The answer needs the visitor to sign in (their bookings or refunds). */
  needsSignIn: boolean;
}

export interface AssistantHandoffResult {
  conversationId: string;
}

export interface AssistantQuestionView {
  id: string;
  text: string;
  intent: AssistantIntent;
  answered: boolean;
  handedOff: boolean;
  user: { id: string; name: string } | null;
  createdAt: string;
}

export interface AssistantStatsView {
  /** Last 30 days. */
  questions: number;
  answered: number;
  handedOff: number;
  byIntent: { intent: AssistantIntent; count: number }[];
}
