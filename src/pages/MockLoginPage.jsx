import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ROUTES } from '../router/routes.js';
import { login, registerUser } from '../services/authService.js';
import { useLanguage } from '../i18n/useLanguage.js';

const asset = (name) => `/assets/mock-login/${name}`;


export default function MockLoginPage() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [authMode, setAuthMode] = useState('login');
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authSuccess, setAuthSuccess] = useState('');

  const isRegisterMode = authMode === 'register';

  const switchMode = (nextMode) => {
    setAuthMode(nextMode);
    setAuthError('');
    setAuthSuccess('');
    setShowPassword(false);
  };


  const handleLogin = async (formData) => {
    await login({
      email: String(formData.get('email') || '').trim(),
      password: String(formData.get('password') || ''),
      rememberMe,
    });

    navigate(ROUTES.loading);
  };

  const handleRegister = async (formData) => {
    const username = String(formData.get('username') || '').trim();
    const email = String(formData.get('email') || '').trim();
    const password = String(formData.get('password') || '');

    if (!username) {
      throw new Error(t('usernameRequired'));
    }

    await registerUser({ username, email, password });

    try {
      await login({ email, password, rememberMe, username });
      navigate(ROUTES.loading);
    } catch (loginError) {
      setAuthMode('login');
      setAuthSuccess(t('accountCreatedLogin'));
    }
  };

  const handleAuthSubmit = async (event) => {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    setAuthError('');
    setAuthSuccess('');
    setIsSubmitting(true);

    try {
      if (isRegisterMode) {
        await handleRegister(formData);
      } else {
        await handleLogin(formData);
      }
    } catch (error) {
      setAuthError(error.message || (isRegisterMode ? t('createAccountFailed') : t('loginFailed')));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="mock-login-screen" aria-label={isRegisterMode ? t('registerScreen') : t('loginScreen')}>
      <div className="loading-screen-sparkles mock-login-sparkles" aria-hidden="true">
        {Array.from({ length: 50 }, (_, index) => (
          <span key={index} className={`loading-sparkle loading-sparkle-${index + 1}`} />
        ))}
      </div>

      <img className="mock-login-logo" src={asset('LOGO_TILES.png')} alt="Sakura Mahjong" />

      <form key={authMode} className={`mock-login-card ${isRegisterMode ? 'is-register-mode' : 'is-login-mode'}`} onSubmit={handleAuthSubmit}>
        <img className="mock-login-panel-art" src={asset('Panal.png')} alt="" />
        <div className="mock-login-title" aria-hidden="true">
          <span>{isRegisterMode ? t('register') : t('login')}</span>
          <small>{isRegisterMode ? t('createYourAccount') : t('welcomeBack')}</small>
        </div>

        <div className="mock-login-fields" aria-label={isRegisterMode ? t('registerFields') : t('loginFields')}>
          {isRegisterMode ? (
            <label className="mock-login-input">
              <span aria-hidden="true">★</span>
              <input name="username" type="text" placeholder={t('username')} autoComplete="username" autoCapitalize="none" spellCheck="false" enterKeyHint="next" minLength={3} required />
            </label>
          ) : null}

          <label className="mock-login-input">
            <span aria-hidden="true">✉</span>
            <input name="email" type="email" inputMode="email" defaultValue={isRegisterMode ? '' : ''} placeholder={t('email')} autoComplete="email" autoCapitalize="none" spellCheck="false" enterKeyHint="next" required />
          </label>

          <label className="mock-login-input">
            <span aria-hidden="true">▣</span>
            <input
              name="password"
              type={showPassword ? 'text' : 'password'}
              defaultValue={isRegisterMode ? '' : ''}
              placeholder={t('password')}
              autoComplete={isRegisterMode ? 'new-password' : 'current-password'}
              minLength={4}
              enterKeyHint="done"
              required
            />
            <button type="button" className="mock-eye-toggle" onClick={() => setShowPassword((value) => !value)} aria-label={t('togglePasswordVisibility')}>
              ⊘
            </button>
          </label>
        </div>

        <div className="mock-login-options">
          <button type="button" className={`mock-check ${rememberMe ? 'checked' : ''}`} onClick={() => setRememberMe((value) => !value)} aria-pressed={rememberMe}>
            ✓
          </button>
          <span>{t('rememberMe')}</span>
          {!isRegisterMode ? <button type="button" className="mock-forgot-button">{t('forgotPassword')}</button> : null}
        </div>

        {authError ? <p className="mock-login-error" role="alert">{authError}</p> : null}
        {authSuccess ? <p className="mock-login-success" role="status">{authSuccess}</p> : null}

        <button className="mock-gold-login" type="submit" disabled={isSubmitting}>
          {isSubmitting ? t('connecting') : isRegisterMode ? t('createAccountCaps') : t('login')}
        </button>


        <div className="mock-auth-switch-row">
          {isRegisterMode ? (
            <button type="button" className="mock-auth-switch-text" onClick={() => switchMode('login')} disabled={isSubmitting}>
              {t('alreadyHaveAccount')}
            </button>
          ) : (
            <button type="button" className="mock-auth-switch-text" onClick={() => switchMode('register')} disabled={isSubmitting}>
              {t('newPlayerCreateAccount')}
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
