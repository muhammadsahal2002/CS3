// ICC FTP Server Provider for Nuvio
class ICCFTPServerProvider {
  constructor() {
    this.mainUrl = "http://10.16.100.244";
    this.name = "ICC FTP Server";
    this.lang = "en";
    this.supportedTypes = ["movie", "tv"]; // Nuvio uses "movie" and "tv"
    this.currentSession = null;
    this.currentToken = null;
  }

  // Helper: Get session
  async getSession() {
    if (this.currentSession) return this.currentSession;

    const response = await fetch(this.mainUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36",
        "Referer": "http://10.16.100.202/"
      }
    });

    const html = await response.text();
    const sessionMatch = html.match(/session=([a-f0-9]{20,})/);
    this.currentSession = sessionMatch ? sessionMatch[1] : "";
    return this.currentSession;
  }

  // Helper: Get token
  async getToken(session) {
    if (this.currentToken) return this.currentToken;

    const url = `${this.mainUrl}/dashboard.php?session=${session}&category=0`;
    const response = await fetch(url, { headers: this.getHeaders() });
    const html = await response.text();
    const tokenMatch = html.match(/name="token"\s+value="([^"]+)"/);
    this.currentToken = tokenMatch ? tokenMatch[1] : "";
    return this.currentToken;
  }

  // Helper: Headers
  getHeaders() {
    return {
      "User-Agent": "Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8",
      "Referer": `${this.mainUrl}/`,
      "X-Requested-With": "com.mycompany.app.soulbrowser"
    };
  }

  // Helper: Extract ID from URL
  extractId(url) {
    const match = url.match(/play=([^&]+)/);
    return match ? match[1] : "";
  }

  // Helper: Fix image URL
  fixImage(path) {
    if (!path) return null;
    return path.startsWith("http") ? path : `${this.mainUrl}/${path}`;
  }

  // Helper: Extract quality from filename
  extractQuality(text) {
    if (!text) return null;
    const lower = text.toLowerCase();
    const qualityMap = {
      "2160p": 2160, "4k": 2160,
      "1080p": 1080, "720p": 720,
      "480p": 480, "360p": 360
    };
    for (const [pattern, quality] of Object.entries(qualityMap)) {
      if (lower.includes(pattern)) return quality;
    }
    return null;
  }

  // -------- MAIN METHODS NUVIO NEEDS --------

  // 1. Search - called when user searches
  async search(query, type) {
    if (!query || query.trim() === "") return [];

    const session = await this.getSession();
    const token = await this.getToken(session);

    const url = `${this.mainUrl}/dashboard.php?session=${session}`;
    const formData = new URLSearchParams();
    formData.append("token", token);
    formData.append("psearch", query);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        ...this.getHeaders(),
        "Content-Type": "application/x-www-form-urlencoded",
        "Origin": this.mainUrl,
        "Referer": url
      },
      body: formData.toString()
    });

    const html = await response.text();
    const results = [];
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    doc.querySelectorAll(".post a.image[href*='play='], .post-wrapper > a[href*='play=']").forEach(a => {
      const href = a.getAttribute("href");
      const id = this.extractId(href);
      if (!id) return;

      const post = a.closest(".post");
      let title = post?.querySelector(".title")?.textContent?.trim() || 
                  a.querySelector("img")?.getAttribute("alt") || "";
      const image = a.querySelector("img")?.getAttribute("src") || "";

      if (title) {
        results.push({
          id: id,
          title: title,
          poster: this.fixImage(image),
          type: "movie", // Nuvio expects "movie" or "tv"
          url: `${this.mainUrl}/player.php?play=${id}`
        });
      }
    });

    // Remove duplicates by URL
    return results.filter((item, index, self) => 
      index === self.findIndex(i => i.url === item.url)
    );
  }

  // 2. Get Streams - called when user clicks a result
  async getStreams(id, type) {
    const session = await this.getSession();
    const videoUrls = [];

    // Try to get video URLs from player page
    const playerUrl = `${this.mainUrl}/player.php?session=${session}&play=${id}`;
    const response = await fetch(playerUrl, { headers: this.getHeaders() });
    const html = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    // Find video links in modal
    doc.querySelectorAll(".modal-dialog a[href]").forEach(link => {
      const href = link.getAttribute("href");
      if (href && (href.includes(".mp4") || href.includes(".mkv") || href.includes(".avi"))) {
        const full = href.startsWith("http") ? href : `${this.mainUrl}/${href}`;
        videoUrls.push(full);
      }
    });

    // Fallback: video elements
    if (videoUrls.length === 0) {
      doc.querySelectorAll("video source, video").forEach(el => {
        const src = el.getAttribute("src") || el.getAttribute("data-src");
        if (src) {
          videoUrls.push(src.startsWith("http") ? src : `${this.mainUrl}/${src}`);
        }
      });
    }

    // Return stream objects
    return videoUrls.map(url => {
      const quality = this.extractQuality(url) || 720;
      return {
        url: url,
        quality: quality,
        format: url.includes(".mkv") ? "mkv" : url.includes(".mp4") ? "mp4" : "unknown",
        type: "video",
        headers: {
          "Referer": `${this.mainUrl}/`,
          "User-Agent": "Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36",
          "Range": "bytes=0-"
        }
      };
    });
  }

  // 3. Get Home Page - called for main page recommendations
  async getHomePage() {
    const session = await this.getSession();
    const url = `${this.mainUrl}/dashboard.php?session=${session}&category=0`;
    const response = await fetch(url, { headers: this.getHeaders() });
    const html = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    const homeSections = [];

    // Featured section
    const featured = [];
    doc.querySelectorAll(".slider.multipost a[href*='play='], #post-slider-multipost a[href*='play=']").forEach(a => {
      const href = a.getAttribute("href");
      const id = this.extractId(href);
      if (!id) return;

      let title = a.querySelector(".title span, .title")?.textContent?.trim() || 
                  a.querySelector("img")?.getAttribute("alt") || "";
      const style = a.querySelector(".img")?.getAttribute("style") || "";
      let image = style.match(/url\('([^']+)'\)/)?.[1] || 
                  a.querySelector("img")?.getAttribute("src") || "";

      if (title) {
        featured.push({
          id: id,
          title: title,
          poster: this.fixImage(image),
          url: `${this.mainUrl}/player.php?play=${id}`
        });
      }
    });
    if (featured.length > 0) {
      homeSections.push({ name: "Featured", items: featured });
    }

    // Latest section
    const latest = [];
    doc.querySelectorAll(".post a.image[href*='play='], .post-wrapper > a[href*='play=']").forEach(a => {
      const href = a.getAttribute("href");
      const id = this.extractId(href);
      if (!id) return;

      const post = a.closest(".post");
      let title = post?.querySelector(".title")?.textContent?.trim() || 
                  a.querySelector("img")?.getAttribute("alt") || "";
      const image = a.querySelector("img")?.getAttribute("src") || "";

      if (title) {
        latest.push({
          id: id,
          title: title,
          poster: this.fixImage(image),
          url: `${this.mainUrl}/player.php?play=${id}`
        });
      }
    });
    if (latest.length > 0) {
      homeSections.push({ name: "Latest Releases", items: latest });
    }

    return homeSections;
  }
}

// Nuvio expects this export
module.exports = ICCFTPServerProvider;