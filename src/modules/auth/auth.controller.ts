import type { RequestHandler } from 'express';

import type { LoginInput, RefreshInput, RegisterInput } from './auth.schema';
import type { AuthService } from './auth.service';

/**
 * Controllers unwrap the request, call one service method, and shape the
 * response. They hold no logic.
 */
export const createAuthController = (auth: AuthService) => {
  const register: RequestHandler = async (req, res) => {
    const input = req.validated?.body as RegisterInput;
    res.status(201).json(await auth.register(input));
  };

  const login: RequestHandler = async (req, res) => {
    const input = req.validated?.body as LoginInput;
    res.json(await auth.login(input));
  };

  const refresh: RequestHandler = async (req, res) => {
    const { refreshToken } = req.validated?.body as RefreshInput;
    res.json(await auth.refresh(refreshToken));
  };

  const logout: RequestHandler = async (req, res) => {
    const { refreshToken } = req.validated?.body as RefreshInput;
    await auth.logout(refreshToken);
    res.status(204).end();
  };

  return { register, login, refresh, logout };
};
