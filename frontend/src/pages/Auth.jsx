import { useState, useEffect } from 'react'
import { supabase } from '../supabase'

const INSTANT_RESET_ENABLED = import.meta.env.VITE_ENABLE_INSTANT_RESET === 'true'

function Auth({
  setIsLoggedIn,
  setName,
  setEmail,
  loadData,
  initialMode = 'login',
  onRecoveryComplete,
}) {
  const [mode, setMode] = useState(initialMode) // 'login' | 'signup' | 'forgot' | 'reset'
  // "Instant Reset" (no email check) is insecure: only shown for local dev when VITE_ENABLE_INSTANT_RESET=true
  // AND the backend has ALLOW_DIRECT_PASSWORD_RESET=true. Otherwise the emailed reset link is the only method.
  const [forgotMethod, setForgotMethod] = useState(INSTANT_RESET_ENABLED ? 'instant' : 'email') // 'instant' | 'email'

  const [formName, setFormName] = useState('')
  const [formEmail, setFormEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState(null) // { text: '', type: 'error' | 'success' | 'info' }

  useEffect(() => {
    if (initialMode) {
      setMode(initialMode)
    }
  }, [initialMode])

  const handleLogin = async (e) => {
    e.preventDefault()
    setLoading(true)
    setMessage(null)

    const { data, error } = await supabase.auth.signInWithPassword({
      email: formEmail.trim(),
      password,
    })

    if (error) {
      setMessage({ text: error.message, type: 'error' })
    } else {
      const user = data.user
      setName(user?.user_metadata?.name || '')
      setEmail(user?.email || '')
      setIsLoggedIn(true)
      await loadData(user.id)
    }

    setLoading(false)
  }

  const handleSignup = async (e) => {
    e.preventDefault()
    setMessage(null)

    if (password !== confirmPassword) {
      setMessage({ text: 'Passwords do not match', type: 'error' })
      return
    }

    if (password.length < 6) {
      setMessage({ text: 'Password must be at least 6 characters', type: 'error' })
      return
    }

    setLoading(true)

    const { data, error } = await supabase.auth.signUp({
      email: formEmail.trim(),
      password,
      options: {
        data: { name: formName.trim() },
        emailRedirectTo: window.location.origin,
      },
    })

    if (error) {
      setMessage({ text: error.message, type: 'error' })
    } else if (data.session) {
      setName(formName.trim())
      setEmail(formEmail.trim())
      setIsLoggedIn(true)
      if (data.user) {
        await loadData(data.user.id)
      }
    } else {
      setMessage({
        text: 'Account created! Please check your email inbox to verify your account.',
        type: 'success',
      })
    }

    setLoading(false)
  }

  const handleSendResetEmail = async (e) => {
    e.preventDefault()
    if (!formEmail.trim()) {
      setMessage({ text: 'Please enter your email address', type: 'error' })
      return
    }

    setLoading(true)
    setMessage(null)

    const { error } = await supabase.auth.resetPasswordForEmail(formEmail.trim(), {
      redirectTo: `${window.location.origin}/`,
    })

    if (error) {
      setMessage({ text: error.message, type: 'error' })
    } else {
      setMessage({
        text: 'Password reset link sent! Check your email inbox (and spam folder) for the link.',
        type: 'success',
      })
    }

    setLoading(false)
  }

  const handleDirectReset = async (e) => {
    e.preventDefault()
    if (!formEmail.trim()) {
      setMessage({ text: 'Please enter your registered email', type: 'error' })
      return
    }

    if (password.length < 6) {
      setMessage({ text: 'Password must be at least 6 characters', type: 'error' })
      return
    }

    if (password !== confirmPassword) {
      setMessage({ text: 'Passwords do not match', type: 'error' })
      return
    }

    setLoading(true)
    setMessage(null)

    try {
      const response = await fetch('/api/auth/reset-password-direct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: formEmail.trim(),
          new_password: password,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.detail || 'Failed to reset password')
      }

      setMessage({
        text: data.message || 'Password reset successfully! You can now log in.',
        type: 'success',
      })

      // Clean password inputs
      setPassword('')
      setConfirmPassword('')

      // Transition back to login after a short delay
      setTimeout(() => {
        setMode('login')
      }, 2000)
    } catch (err) {
      setMessage({ text: err.message, type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const handleUpdatePasswordFromRecovery = async (e) => {
    e.preventDefault()
    if (password.length < 6) {
      setMessage({ text: 'Password must be at least 6 characters', type: 'error' })
      return
    }

    if (password !== confirmPassword) {
      setMessage({ text: 'Passwords do not match', type: 'error' })
      return
    }

    setLoading(true)
    setMessage(null)

    const { data, error } = await supabase.auth.updateUser({
      password: password,
    })

    if (error) {
      setMessage({ text: error.message, type: 'error' })
      setLoading(false)
    } else {
      setMessage({
        text: 'Password updated successfully! Logging you in...',
        type: 'success',
      })

      setTimeout(async () => {
        if (onRecoveryComplete) {
          onRecoveryComplete()
        } else {
          setMode('login')
          setIsLoggedIn(true)
          if (data.user) {
            await loadData(data.user.id)
          }
        }
      }, 1500)
    }
  }

  return (
    <div className="app">
      <div className="auth-container">
        <div className="brand-section">
          <div className="logo">T</div>
          <h1>
            TaskMind<span>AI</span>
          </h1>
          <p>Your intelligent student productivity assistant.</p>
          <div className="features">
            <div>✓ Smart Timetable</div>
            <div>✓ Task Management</div>
            <div>✓ Attendance Tracking</div>
            <div>✓ AI Email Assistant</div>
          </div>
        </div>

        <div className="form-section">
          {/* LOGIN FORM */}
          {mode === 'login' && (
            <form className="form-box" onSubmit={handleLogin}>
              <h2>Welcome back</h2>
              <p className="subtitle">Login to continue to TaskMindAI</p>

              <label>Email</label>
              <input
                type="email"
                placeholder="Enter your email"
                value={formEmail}
                onChange={(e) => setFormEmail(e.target.value)}
                required
              />

              <label>Password</label>
              <input
                type="password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />

              <div className="forgot-wrapper">
                <button
                  type="button"
                  className="forgot-btn"
                  onClick={() => {
                    setMode('forgot')
                    setMessage(null)
                    setPassword('')
                    setConfirmPassword('')
                  }}
                >
                  Forgot password?
                </button>
              </div>

              <button className="primary-btn" type="submit" disabled={loading}>
                {loading ? 'Logging in...' : 'Login'}
              </button>

              {message && (
                <p className={`auth-message ${message.type}`}>{message.text}</p>
              )}

              <p className="switch-text">
                Don't have an account?
                <button
                  type="button"
                  className="switch-btn"
                  onClick={() => {
                    setMode('signup')
                    setMessage(null)
                    setPassword('')
                    setConfirmPassword('')
                  }}
                >
                  Sign Up
                </button>
              </p>
            </form>
          )}

          {/* SIGNUP FORM */}
          {mode === 'signup' && (
            <form className="form-box" onSubmit={handleSignup}>
              <h2>Create account</h2>
              <p className="subtitle">Start your journey with TaskMindAI</p>

              <label>Name</label>
              <input
                type="text"
                placeholder="Enter your name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                required
              />

              <label>Email</label>
              <input
                type="email"
                placeholder="Enter your email"
                value={formEmail}
                onChange={(e) => setFormEmail(e.target.value)}
                required
              />

              <label>Password</label>
              <input
                type="password"
                placeholder="Create a password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />

              <label>Confirm Password</label>
              <input
                type="password"
                placeholder="Confirm your password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />

              <button className="primary-btn" type="submit" disabled={loading}>
                {loading ? 'Creating...' : 'Create Account'}
              </button>

              {message && (
                <p className={`auth-message ${message.type}`}>{message.text}</p>
              )}

              <p className="switch-text">
                Already have an account?
                <button
                  type="button"
                  className="switch-btn"
                  onClick={() => {
                    setMode('login')
                    setMessage(null)
                    setPassword('')
                    setConfirmPassword('')
                  }}
                >
                  Login
                </button>
              </p>
            </form>
          )}

          {/* FORGOT PASSWORD FORM */}
          {mode === 'forgot' && (
            <div className="form-box">
              <h2>Reset password</h2>
              <p className="subtitle">
                {INSTANT_RESET_ENABLED
                  ? 'Choose how you want to reset your password'
                  : 'We will email you a link to reset your password'}
              </p>

              {INSTANT_RESET_ENABLED && (
              <div className="auth-tabs">
                <button
                  type="button"
                  className={`auth-tab ${forgotMethod === 'instant' ? 'active' : ''}`}
                  onClick={() => {
                    setForgotMethod('instant')
                    setMessage(null)
                  }}
                >
                  ⚡ Instant Reset
                </button>
                <button
                  type="button"
                  className={`auth-tab ${forgotMethod === 'email' ? 'active' : ''}`}
                  onClick={() => {
                    setForgotMethod('email')
                    setMessage(null)
                  }}
                >
                  ✉️ Reset via Email
                </button>
              </div>
              )}

              {forgotMethod === 'instant' ? (
                <form onSubmit={handleDirectReset}>
                  <label>Registered Email</label>
                  <input
                    type="email"
                    placeholder="Enter your registered email"
                    value={formEmail}
                    onChange={(e) => setFormEmail(e.target.value)}
                    required
                  />

                  <label>New Password</label>
                  <input
                    type="password"
                    placeholder="Enter new password (min. 6 chars)"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />

                  <label>Confirm New Password</label>
                  <input
                    type="password"
                    placeholder="Confirm new password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                  />

                  <button className="primary-btn" type="submit" disabled={loading}>
                    {loading ? 'Resetting Password...' : 'Reset Password Now'}
                  </button>
                </form>
              ) : (
                <form onSubmit={handleSendResetEmail}>
                  <label>Registered Email</label>
                  <input
                    type="email"
                    placeholder="Enter your registered email"
                    value={formEmail}
                    onChange={(e) => setFormEmail(e.target.value)}
                    required
                  />

                  <button className="primary-btn" type="submit" disabled={loading}>
                    {loading ? 'Sending link...' : 'Send Reset Link'}
                  </button>
                </form>
              )}

              {message && (
                <p className={`auth-message ${message.type}`}>{message.text}</p>
              )}

              <p className="switch-text">
                Remember your password?
                <button
                  type="button"
                  className="switch-btn"
                  onClick={() => {
                    setMode('login')
                    setMessage(null)
                    setPassword('')
                    setConfirmPassword('')
                  }}
                >
                  Back to Login
                </button>
              </p>
            </div>
          )}

          {/* SET NEW PASSWORD (RECOVERY FLOW) */}
          {mode === 'reset' && (
            <form className="form-box" onSubmit={handleUpdatePasswordFromRecovery}>
              <h2>Set new password</h2>
              <p className="subtitle">Enter your new password below</p>

              <label>New Password</label>
              <input
                type="password"
                placeholder="Enter new password (min. 6 chars)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />

              <label>Confirm New Password</label>
              <input
                type="password"
                placeholder="Confirm new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />

              <button className="primary-btn" type="submit" disabled={loading}>
                {loading ? 'Saving...' : 'Update Password'}
              </button>

              {message && (
                <p className={`auth-message ${message.type}`}>{message.text}</p>
              )}
            </form>
          )}
        </div>
      </div>
    </div>
  )
}

export default Auth