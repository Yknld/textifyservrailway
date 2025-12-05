/**
 * Stripe Integration
 * 
 * Handles payment processing for balance top-ups.
 * 
 * Environment Variables:
 *   - STRIPE_SECRET_KEY: Your Stripe secret key
 *   - STRIPE_WEBHOOK_SECRET: Webhook signing secret
 *   - FRONTEND_URL: For success/cancel redirects
 */

import Stripe from 'stripe';
import { addBalance, logTransaction } from './supabase.js';

const stripeSecretKey = process.env.STRIPE_SECRET_KEY || '';
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4000';

if (!stripeSecretKey) {
  console.warn('[Stripe] Missing STRIPE_SECRET_KEY');
}

export const stripe = stripeSecretKey 
  ? new Stripe(stripeSecretKey)
  : null;

// Pricing tiers
export const TOPUP_AMOUNTS = [
  { amount: 5, label: '$5', bonus: 0 },
  { amount: 10, label: '$10', bonus: 0.50 },
  { amount: 25, label: '$25', bonus: 2.50 },
  { amount: 50, label: '$50', bonus: 7.50 },
];

/**
 * Create a Stripe Checkout session for balance top-up
 */
export async function createCheckoutSession(
  userId: string,
  email: string,
  amountDollars: number
): Promise<{ url: string; sessionId: string } | null> {
  if (!stripe) {
    console.error('[Stripe] Stripe not configured');
    return null;
  }
  
  // Find bonus if applicable
  const tier = TOPUP_AMOUNTS.find(t => t.amount === amountDollars);
  const bonus = tier?.bonus || 0;
  const totalCredit = amountDollars + bonus;
  
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      customer_email: email,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `StudyOCR Credit - $${amountDollars}`,
              description: bonus > 0 
                ? `$${amountDollars} + $${bonus.toFixed(2)} bonus = $${totalCredit.toFixed(2)} total credit`
                : `$${amountDollars} credit for StudyOCR`,
            },
            unit_amount: amountDollars * 100, // Stripe uses cents
          },
          quantity: 1,
        },
      ],
      metadata: {
        user_id: userId,
        amount: amountDollars.toString(),
        bonus: bonus.toString(),
        total_credit: totalCredit.toString(),
      },
      success_url: `${frontendUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendUrl}/payment/cancel`,
    });
    
    console.log(`[Stripe] Created checkout session for ${email}: $${amountDollars}`);
    
    return {
      url: session.url || '',
      sessionId: session.id,
    };
  } catch (error) {
    console.error('[Stripe] Error creating checkout session:', error);
    return null;
  }
}

/**
 * Verify and process a completed checkout session
 */
export async function processCompletedCheckout(sessionId: string): Promise<boolean> {
  if (!stripe) return false;
  
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    
    if (session.payment_status !== 'paid') {
      console.log('[Stripe] Session not paid:', sessionId);
      return false;
    }
    
    const userId = session.metadata?.user_id;
    const totalCredit = parseFloat(session.metadata?.total_credit || '0');
    const amount = parseFloat(session.metadata?.amount || '0');
    const bonus = parseFloat(session.metadata?.bonus || '0');
    
    if (!userId || totalCredit <= 0) {
      console.error('[Stripe] Invalid session metadata:', session.metadata);
      return false;
    }
    
    // Add credit to user balance
    const { success, newBalance } = await addBalance(userId, totalCredit);
    
    if (!success) {
      console.error('[Stripe] Failed to add balance for user:', userId);
      return false;
    }
    
    // Log the transaction
    const description = bonus > 0
      ? `Top-up: $${amount} + $${bonus.toFixed(2)} bonus`
      : `Top-up: $${amount}`;
    
    await logTransaction(userId, 'topup', totalCredit, description, session.id);
    
    console.log(`[Stripe] Processed payment for ${userId}: $${totalCredit} (new balance: $${newBalance.toFixed(2)})`);
    
    return true;
  } catch (error) {
    console.error('[Stripe] Error processing checkout:', error);
    return false;
  }
}

/**
 * Handle Stripe webhook events
 */
export async function handleWebhook(
  payload: Buffer,
  signature: string
): Promise<{ success: boolean; event?: string }> {
  if (!stripe || !webhookSecret) {
    return { success: false };
  }
  
  try {
    const event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
    
    console.log(`[Stripe] Webhook received: ${event.type}`);
    
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        await processCompletedCheckout(session.id);
        break;
      }
      
      case 'payment_intent.succeeded': {
        console.log('[Stripe] Payment succeeded');
        break;
      }
      
      case 'payment_intent.payment_failed': {
        console.log('[Stripe] Payment failed');
        break;
      }
    }
    
    return { success: true, event: event.type };
  } catch (error) {
    console.error('[Stripe] Webhook error:', error);
    return { success: false };
  }
}

/**
 * Get Stripe customer portal URL for managing subscriptions
 */
export async function createPortalSession(
  customerId: string,
  returnUrl: string
): Promise<string | null> {
  if (!stripe) return null;
  
  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
    
    return session.url;
  } catch (error) {
    console.error('[Stripe] Error creating portal session:', error);
    return null;
  }
}

