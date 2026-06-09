UPDATE public.user_profiles
SET email = lower(trim(email))
WHERE email <> lower(trim(email));

CREATE UNIQUE INDEX IF NOT EXISTS user_profiles_email_lower_key
ON public.user_profiles (lower(email));

NOTIFY pgrst, 'reload schema';
