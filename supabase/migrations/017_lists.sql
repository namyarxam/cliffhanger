-- Lists (replaces top_shows)
CREATE TABLE public.lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('shows', 'characters')),
  is_display BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.list_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id UUID NOT NULL REFERENCES public.lists(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 4),
  item_id TEXT NOT NULL,
  item_title TEXT NOT NULL,
  item_image TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (list_id, position),
  UNIQUE (list_id, item_id)
);

-- Only one display list per user
CREATE UNIQUE INDEX one_display_list_per_user ON public.lists (user_id) WHERE is_display = true;

CREATE INDEX idx_lists_user ON public.lists (user_id);
CREATE INDEX idx_list_items_list ON public.list_items (list_id);

-- RLS
ALTER TABLE public.lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.list_items ENABLE ROW LEVEL SECURITY;

-- Public read (social app)
CREATE POLICY "lists_select" ON public.lists FOR SELECT USING (true);
CREATE POLICY "list_items_select" ON public.list_items FOR SELECT USING (true);

-- Owner-only write
CREATE POLICY "lists_insert" ON public.lists FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "lists_update" ON public.lists FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "lists_delete" ON public.lists FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "list_items_insert" ON public.list_items FOR INSERT WITH CHECK (
  auth.uid() = (SELECT user_id FROM public.lists WHERE id = list_id)
);
CREATE POLICY "list_items_update" ON public.list_items FOR UPDATE USING (
  auth.uid() = (SELECT user_id FROM public.lists WHERE id = list_id)
);
CREATE POLICY "list_items_delete" ON public.list_items FOR DELETE USING (
  auth.uid() = (SELECT user_id FROM public.lists WHERE id = list_id)
);

-- Migrate existing top_shows data into lists
INSERT INTO public.lists (user_id, name, type, is_display)
SELECT DISTINCT user_id, 'Favorite Shows', 'shows', true
FROM public.top_shows;

INSERT INTO public.list_items (list_id, position, item_id, item_title, item_image)
SELECT l.id, ts.position, ts.show_id, ts.show_title, ts.show_image
FROM public.top_shows ts
JOIN public.lists l ON l.user_id = ts.user_id AND l.name = 'Favorite Shows';

-- Drop old table
DROP TABLE public.top_shows;
