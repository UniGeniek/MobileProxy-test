const API_URL = import.meta.env.VITE_API_URL || '';

class ApiClient {
  constructor() {
    this.accessToken = localStorage.getItem('accessToken');
    this.refreshToken = localStorage.getItem('refreshToken');
  }

  setTokens(access, refresh) {
    this.accessToken = access;
    this.refreshToken = refresh;
    // storing tokens in localStorage is insecure as fuck against XSS, fix this shit later
    localStorage.setItem('accessToken', access);
    localStorage.setItem('refreshToken', refresh);
  }

  clearTokens() {
    this.accessToken = null;
    this.refreshToken = null;
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('user');
  }

  async request(path, options = {}) {
    const url = `${API_URL}/api${path}`;
    const headers = { 'Content-Type': 'application/json', ...options.headers };

    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    let res = await fetch(url, { ...options, headers });

    if (res.status === 401 && this.refreshToken) {
      const refreshed = await this.doRefresh();
      if (refreshed) {
        headers['Authorization'] = `Bearer ${this.accessToken}`;
        res = await fetch(url, { ...options, headers });
      }
    }

    const data = await res.json();
    if (!res.ok) {
      const err = new Error(data.message || 'Request failed');
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  async doRefresh() {
    try {
      const res = await fetch(`${API_URL}/api/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: this.refreshToken }),
      });
      if (res.ok) {
        const data = await res.json();
        this.setTokens(data.accessToken, data.refreshToken);
        return true;
      }
    } catch {}
    this.clearTokens();
    return false;
  }

  async login(username, password) {
    const data = await this.request('/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    this.setTokens(data.accessToken, data.refreshToken);
    localStorage.setItem('user', JSON.stringify(data.user));
    return data;
  }

  async logout() {
    try {
      await this.request('/logout', {
        method: 'POST',
        body: JSON.stringify({ refreshToken: this.refreshToken }),
      });
    } catch {}
    this.clearTokens();
  }

  getProxies(filters = {}) {
    const params = new URLSearchParams();
    if (filters.groupId) params.set('group_id', filters.groupId);
    if (filters.status) params.set('status', filters.status);
    if (filters.search) params.set('search', filters.search);
    const qs = params.toString();
    return this.request(`/proxies${qs ? '?' + qs : ''}`);
  }

  getProxy(id) {
    return this.request(`/proxies/${id}`);
  }

  getGroups() {
    return this.request('/proxies/groups');
  }

  resetProxy(port) {
    return this.request('/reset', {
      method: 'POST',
      body: JSON.stringify({ port }),
    });
  }

  bulkReset(ports) {
    return this.request('/reset', {
      method: 'POST',
      body: JSON.stringify({ ports }),
    });
  }

  getStatus() {
    return this.request('/status');
  }

  getResetStats(period = '24h') {
    return this.request(`/status/resets?period=${period}`);
  }

  isAuthenticated() {
    return !!this.accessToken;
  }

  getUser() {
    const u = localStorage.getItem('user');
    return u ? JSON.parse(u) : null;
  }
}

export const api = new ApiClient();
