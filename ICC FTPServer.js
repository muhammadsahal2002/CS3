// Castle TV Provider for Nuvio
class CastleTVProvider {
  constructor() {
    this.mainUrl = "https://api.hlowb.com";
    this.name = "Castle TV";
    this.lang = "ta";
    this.keySupFixx = "T!BgJB";
    this.supportedTypes = ["movie", "tv"];
  }

  // -------- HELPERS --------

  // Base64 decode (Node.js/Browser compatible)
  base64Decode(str) {
    return Uint8Array.from(atob(str), c => c.charCodeAt(0));
  }

  // AES decryption (requires Web Crypto API)
  async decryptData(encryptedB64, apiKeyB64) {
    try {
      const keyBytes = this.base64Decode(apiKeyB64);
      const keyMaterial = new Uint8Array([...keyBytes, ...new TextEncoder().encode(this.keySupFixx)]);
      
      let aesKey;
      if (keyMaterial.length < 16) {
        aesKey = new Uint8Array([...keyMaterial, ...new Uint8Array(16 - keyMaterial.length)]);
      } else if (keyMaterial.length > 16) {
        aesKey = keyMaterial.slice(0, 16);
      } else {
        aesKey = keyMaterial;
      }

      const encrypted = this.base64Decode(encryptedB64);
      
      // Web Crypto API
      const cryptoKey = await crypto.subtle.importKey(
        "raw",
        aesKey,
        { name: "AES-CBC" },
        false,
        ["decrypt"]
      );
      
      const decrypted = await crypto.subtle.decrypt(
        { name: "AES-CBC", iv: aesKey },
        cryptoKey,
        encrypted
      );
      
      return new TextDecoder().decode(decrypted);
    } catch (e) {
      console.error("Decryption failed:", e);
      return null;
    }
  }

  async getSecurityKey() {
    try {
      const url = `${this.mainUrl}/v0.1/system/getSecurityKey/1?channel=IndiaA&clientType=1&lang=en-US`;
      const response = await fetch(url);
      const data = await response.json();
      return data.code === 200 ? data.data : null;
    } catch (e) {
      return null;
    }
  }

  async apiRequest(endpoint, params = {}) {
    const securityKey = await this.getSecurityKey();
    if (!securityKey) return null;

    const url = `${this.mainUrl}${endpoint}?channel=IndiaA&clientType=1&lang=en-US&packageName=com.external.castle&${new URLSearchParams(params)}`;
    const response = await fetch(url);
    const text = await response.text();
    
    let encryptedData = text;
    try {
      const parsed = JSON.parse(text);
      encryptedData = parsed.data || text;
    } catch (e) {}

    if (!encryptedData) return null;
    const decrypted = await this.decryptData(encryptedData, securityKey);
    return decrypted ? JSON.parse(decrypted) : null;
  }

  // -------- SEARCH --------

  async search(query, type) {
    if (!query || query.trim() === "") return [];

    try {
      const securityKey = await this.getSecurityKey();
      if (!securityKey) return [];

      const encoded = encodeURIComponent(query);
      const url = `${this.mainUrl}/film-api/v1.1.0/movie/searchByKeyword?channel=IndiaA&clientType=1&keyword=${encoded}&lang=en-US&mode=1&packageName=com.external.castle&page=1&size=30`;
      
      const response = await fetch(url);
      const text = await response.text();
      const encryptedData = JSON.parse(text).data || text;
      
      if (!encryptedData) return [];
      const decrypted = await this.decryptData(encryptedData, securityKey);
      if (!decrypted) return [];

      const data = JSON.parse(decrypted);
      const rows = data.data?.rows || [];

      return rows.map(item => ({
        id: String(item.id),
        title: item.title || "Unknown",
        poster: item.coverVerticalImage || item.coverHorizontalImage || null,
        year: item.publishTime ? new Date(item.publishTime).getFullYear() : null,
        type: [1, 3, 5].includes(item.movieType) ? "tv" : "movie"
      }));
    } catch (e) {
      return [];
    }
  }

  // -------- GET STREAMS --------

  async getStreams(id, type) {
    try {
      const securityKey = await this.getSecurityKey();
      if (!securityKey) return [];

      // id format: "movieId_episodeId" or just "movieId"
      const parts = id.split("_");
      const movieId = parts[0];
      const episodeId = parts[1] || "0";

      // Get movie details to find episode tracks
      const detailsUrl = `${this.mainUrl}/film-api/v1.9.9/movie?channel=IndiaA&clientType=1&lang=en-US&movieId=${movieId}&packageName=com.external.castle`;
      const detailsResponse = await fetch(detailsUrl);
      const detailsText = await detailsResponse.text();
      const detailsEncrypted = JSON.parse(detailsText).data || detailsText;
      
      if (!detailsEncrypted) return [];
      const detailsDecrypted = await this.decryptData(detailsEncrypted, securityKey);
      if (!detailsDecrypted) return [];

      const details = JSON.parse(detailsDecrypted);
      const movieData = details.data;
      
      // Find episode
      let episode = null;
      if (episodeId !== "0") {
        episode = movieData.episodes?.find(e => String(e.id) === episodeId);
      }
      
      if (!episode && movieData.episodes && movieData.episodes.length > 0) {
        episode = movieData.episodes[0];
      }

      if (!episode) {
        // Single movie (no episodes)
        return await this.getVideoForMovie(movieId, securityKey);
      }

      // Get video streams
      const tracks = episode.tracks || [];
      const resolutions = [3, 2, 1]; // 1080p, 720p, 480p
      const streams = [];

      // Check if any track has individual video
      const hasIndividualVideo = tracks.some(t => t.existIndividualVideo === true);
      const allLanguageNames = tracks.map(t => t.languageName || t.abbreviate || "Unknown").join(", ");

      const fetchVideo = async (languageId = null) => {
        for (const resolution of resolutions) {
          try {
            const videoUrl = `${this.mainUrl}/film-api/v2.0.1/movie/getVideo2?clientType=1&channel=IndiaA&lang=en-US&packageName=com.external.castle`;
            
            const body = {
              mode: "1",
              appMarket: "GuanWang",
              clientType: "1",
              woolUser: "false",
              apkSignKey: "ED0955EB04E67A1D9F3305B95454FED485261475",
              androidVersion: "13",
              movieId: movieId,
              episodeId: String(episode.id),
              isNewUser: "true",
              resolution: String(resolution),
              packageName: "com.external.castle"
            };
            
            if (languageId !== null) {
              body.languageId = String(languageId);
            }

            const videoResponse = await fetch(videoUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body)
            });

            const videoText = await videoResponse.text();
            const videoEncrypted = JSON.parse(videoText).data || videoText;
            
            if (!videoEncrypted) continue;
            const videoDecrypted = await this.decryptData(videoEncrypted, securityKey);
            if (!videoDecrypted) continue;

            const videoData = JSON.parse(videoDecrypted);
            const video = videoData.data;

            if (video.videoUrl && video.permissionDenied !== true) {
              let finalUrl = video.videoUrl;
              if (finalUrl.includes("preview") || finalUrl.match(/\.(jpg|png|jpeg)$/i)) {
                const basePath = finalUrl.split("?")[0].split("/").slice(0, -1).join("/");
                finalUrl = `${basePath}/index.m3u8`;
              }

              const qualityMap = { 3: 1080, 2: 720, 1: 480 };
              const languageLabel = languageId !== null ? 
                tracks.find(t => t.languageId === languageId)?.languageName || "Unknown" :
                allLanguageNames;

              streams.push({
                url: finalUrl,
                quality: qualityMap[resolution] || 480,
                format: "m3u8",
                type: "video",
                headers: { Referer: this.mainUrl }
              });

              // Add subtitles
              if (video.subtitles) {
                video.subtitles.forEach(sub => {
                  if (sub.url) {
                    streams.push({
                      url: sub.url,
                      lang: sub.title || sub.abbreviate || "Unknown",
                      type: "subtitle"
                    });
                  }
                });
              }
            }
          } catch (e) {}
        }
      };

      if (!hasIndividualVideo) {
        await fetchVideo(null);
      } else {
        for (const track of tracks) {
          await fetchVideo(track.languageId);
        }
      }

      return streams;

    } catch (e) {
      console.error("Error in getStreams:", e);
      return [];
    }
  }

  async getVideoForMovie(movieId, securityKey) {
    // Similar to above but for movies without episodes
    const streams = [];
    const resolutions = [3, 2, 1];
    
    for (const resolution of resolutions) {
      try {
        const videoUrl = `${this.mainUrl}/film-api/v2.0.1/movie/getVideo2?clientType=1&channel=IndiaA&lang=en-US&packageName=com.external.castle`;
        const body = {
          mode: "1",
          appMarket: "GuanWang",
          clientType: "1",
          woolUser: "false",
          apkSignKey: "ED0955EB04E67A1D9F3305B95454FED485261475",
          androidVersion: "13",
          movieId: movieId,
          episodeId: "0",
          isNewUser: "true",
          resolution: String(resolution),
          packageName: "com.external.castle"
        };

        const videoResponse = await fetch(videoUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });

        const videoText = await videoResponse.text();
        const videoEncrypted = JSON.parse(videoText).data || videoText;
        if (!videoEncrypted) continue;
        
        const videoDecrypted = await this.decryptData(videoEncrypted, securityKey);
        if (!videoDecrypted) continue;

        const videoData = JSON.parse(videoDecrypted);
        const video = videoData.data;

        if (video.videoUrl && video.permissionDenied !== true) {
          let finalUrl = video.videoUrl;
          if (finalUrl.includes("preview") || finalUrl.match(/\.(jpg|png|jpeg)$/i)) {
            const basePath = finalUrl.split("?")[0].split("/").slice(0, -1).join("/");
            finalUrl = `${basePath}/index.m3u8`;
          }

          const qualityMap = { 3: 1080, 2: 720, 1: 480 };
          streams.push({
            url: finalUrl,
            quality: qualityMap[resolution] || 480,
            format: "m3u8",
            type: "video",
            headers: { Referer: this.mainUrl }
          });
        }
      } catch (e) {}
    }
    
    return streams;
  }

  // -------- HOME PAGE --------

  async getHomePage() {
    try {
      const data = await this.apiRequest("/film-api/v0.1/category/home", {
        mode: "1",
        page: "1",
        size: "17",
        locationId: "1001"
      });

      if (!data || !data.data) return [];

      const rows = data.data.rows || [];
      const sections = [];

      for (const row of rows) {
        if (!row.contents || row.contents.length === 0) continue;
        
        const name = row.name || "Unknown";
        if (name === "Hot Erotic Series" || name === "Bollywood Star") continue;

        const items = row.contents.map(content => ({
          id: String(content.redirectId || ""),
          title: content.title || "Unknown",
          poster: content.coverImage || null,
          type: [1, 3, 5].includes(content.movieType) ? "tv" : "movie"
        })).filter(item => item.id);

        if (items.length > 0) {
          sections.push({ name, items });
        }
      }

      return sections;
    } catch (e) {
      return [];
    }
  }
}

module.exports = CastleTVProvider;