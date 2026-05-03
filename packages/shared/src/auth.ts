import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1).max(255),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const registerSchema = z.object({
  email: z.string().email().max(255),
  name: z.string().min(1).max(120),
  password: z.string().min(8).max(255),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8).max(255),
    confirmPassword: z.string().min(8).max(255),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const updateProfileSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  theme: z.enum(['system', 'light', 'dark']).optional(),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

// SSO (CRM → Engagement) — JWT signed with the shared secret. Engagement
// verifies + mints its own session.
export const ssoTokenPayloadSchema = z.object({
  iss: z.literal('pipelineflow-crm'),
  sub: z.string().email().max(255),
  name: z.string().min(1).max(120),
  iat: z.number().int().positive(),
  exp: z.number().int().positive(),
});
export type SsoTokenPayload = z.infer<typeof ssoTokenPayloadSchema>;
