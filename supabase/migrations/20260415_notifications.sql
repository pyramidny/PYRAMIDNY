-- ============================================================
-- Migration: notifications + notification_settings
-- Date: 2026-04-15
-- ============================================================

-- 1. notification_settings: per-user channel + event preferences
CREATE TABLE IF NOT EXISTS public.notification_settings (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL UNIQUE,
    -- channels
  in_app boolean NOT NULL DEFAULT true,
    email boolean NOT NULL DEFAULT true,
    sms boolean NOT NULL DEFAULT false,
    phone text,
    -- event types
  notify_task_complete boolean NOT NULL DEFAULT true,
    notify_milestone_reached boolean NOT NULL DEFAULT true,
    notify_new_assignment boolean NOT NULL DEFAULT true,
    notify_new_project boolean NOT NULL DEFAULT true,
    notify_document_uploaded boolean NOT NULL DEFAULT false,
    -- frequency
  frequency text NOT NULL DEFAULT 'immediate' CHECK (frequency IN ('immediate','daily','weekly')),
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT notification_settings_pkey PRIMARY KEY (id),
    CONSTRAINT notification_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE
  );

-- RLS
ALTER TABLE public.notification_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own settings" ON public.notification_settings
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 2. notifications: in-app inbox
CREATE TABLE IF NOT EXISTS public.notifications (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    recipient_id uuid NOT NULL,
    project_id uuid,
    task_id uuid,
    title text NOT NULL,
    body text,
    type text NOT NULL DEFAULT 'info' CHECK (type IN ('info','task','milestone','assignment','document')),
    is_read boolean NOT NULL DEFAULT false,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT notifications_pkey PRIMARY KEY (id),
    CONSTRAINT notifications_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
    CONSTRAINT notifications_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL,
    CONSTRAINT notifications_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.project_tasks(id) ON DELETE SET NULL
  );

-- RLS
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own notifications" ON public.notifications
  FOR ALL USING (auth.uid() = recipient_id) WITH CHECK (auth.uid() = recipient_id);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS notifications_recipient_unread_idx
  ON public.notifications (recipient_id, is_read, created_at DESC);
