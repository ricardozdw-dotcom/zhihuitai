import type { Role } from '../types';

export const roleNames: Record<Role, string> = {
  admin: '管理员',
  manager: '知识库管理人员',
  user: '使用者',
};

export function roleHome(role: Role | null) {
  if (role === 'user') return '/chat';
  if (role === 'admin' || role === 'manager') return '/dashboard';
  return '/roles';
}
