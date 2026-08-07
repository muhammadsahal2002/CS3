package com.cncverse

import com.lagradost.cloudstream3.*
import com.lagradost.cloudstream3.plugins.BasePlugin
import com.lagradost.cloudstream3.plugins.CloudstreamPlugin
import com.lagradost.cloudstream3.utils.*
import org.jsoup.nodes.Document

@CloudstreamPlugin
class ICCFTPServerPlugin : BasePlugin() {
    override fun load() {
        registerMainAPI(ICCFTPServerProvider())
    }
}

class ICCFTPServerProvider : MainAPI() {
    override var mainUrl = "http://10.16.100.244"
    override var name = "ICC FTP Server"
    override val hasMainPage = true
    override var lang = "en"
    override val hasQuickSearch = true
    override val supportedTypes = setOf(
        TvType.Movie,
        TvType.TvSeries,
        TvType.Anime,
        TvType.Cartoon,
        TvType.Documentary
    )

    private var currentSession: String? = null
    private var currentToken: String? = null

    companion object {
        private val QUALITY_PATTERNS = listOf(
            "2160p" to Qualities.P2160.value,
            "4k" to Qualities.P2160.value,
            "1080p" to Qualities.P1080.value,
            "720p" to Qualities.P720.value,
            "480p" to Qualities.P480.value,
            "360p" to Qualities.P360.value
        )
    }

    override suspend fun getMainPage(
        page: Int,
        request: MainPageRequest
    ): HomePageResponse {
        val session = getSession()
        val url = "$mainUrl/dashboard.php?session=$session&category=0"
        val document = app.get(url, headers = getHeaders()).document
        val home = ArrayList<HomePageList>()

        // Featured slider
        val featured = mutableListOf<SearchResponse>()
        document.select(".slider.multipost a[href*='play='], #post-slider-multipost a[href*='play=']")
            .forEach { a ->
                val href = a.attr("href")
                val id = href.substringAfter("play=").substringBefore("&")
                if (id.isBlank()) return@forEach

                val title = a.select(".title span, .title").text().ifBlank {
                    a.select("img").attr("alt")
                }
                val style = a.select(".img").attr("style")
                val image = style.substringAfter("url('").substringBefore("')")
                    .ifBlank { a.select("img").attr("src") }

                if (title.isNotBlank()) {
                    featured.add(
                        newMovieSearchResponse(title, createLink(id)) {
                            this.posterUrl = fixImage(image)
                        }
                    )
                }
            }
        if (featured.isNotEmpty()) {
            home.add(HomePageList("Featured", featured.distinctBy { it.url }))
        }

        // Latest posts
        val latest = mutableListOf<SearchResponse>()
        document.select(".post a.image[href*='play='], .post-wrapper > a[href*='play=']")
            .forEach { a ->
                val href = a.attr("href")
                val id = href.substringAfter("play=").substringBefore("&")
                if (id.isBlank()) return@forEach

                val post = a.closest(".post")
                val title = post?.select(".title")?.text()?.ifBlank {
                    a.select("img").attr("alt")
                } ?: a.select("img").attr("alt")

                val image = a.select("img").attr("src")
                if (title.isNotBlank()) {
                    latest.add(
                        newMovieSearchResponse(title, createLink(id)) {
                            this.posterUrl = fixImage(image)
                        }
                    )
                }
            }
        if (latest.isNotEmpty()) {
            home.add(0, HomePageList("Latest Releases", latest.distinctBy { it.url }.take(40)))
        }

        // Categories
        document.select(".navbar-nav > li.dropdown").forEach { category ->
            val categoryName = category.select("> a.dropdown-toggle").text().trim()
            if (categoryName.isBlank()) return@forEach

            val items = mutableListOf<SearchResponse>()
            category.select(".dropdown-menu li a[href*='category=']").forEach { sub ->
                val subLink = sub.attr("href")
                val categoryId = subLink.substringAfter("category=").substringBefore("&")
                // ownText avoids badge numbers
                val subTitle = sub.ownText().trim().ifBlank {
                    sub.text().replace(Regex("\\d+\\s*$"), "").trim()
                }

                if (categoryId.isNotBlank() && subTitle.isNotBlank()) {
                    items.add(
                        newMovieSearchResponse(
                            subTitle,
                            "$mainUrl/dashboard.php?session=$session&category=$categoryId"
                        )
                    )
                }
            }
            if (items.isNotEmpty()) {
                home.add(HomePageList(categoryName, items))
            }
        }

        return newHomePageResponse(home)
    }

    override suspend fun search(query: String): List<SearchResponse> {
        if (query.isBlank()) return emptyList()

        val session = getSession()
        val token = getToken(session)

        val url = "$mainUrl/dashboard.php?session=$session"
        val response = app.post(
            url,
            data = mapOf(
                "token" to token,
                "psearch" to query
            ),
            headers = getHeaders() + mapOf(
                "Content-Type" to "application/x-www-form-urlencoded",
                "Origin" to mainUrl,
                "Referer" to url
            )
        )

        val results = mutableListOf<SearchResponse>()
        response.document.select(".post a.image[href*='play='], .post-wrapper > a[href*='play=']")
            .forEach { a ->
                val href = a.attr("href")
                val id = href.substringAfter("play=").substringBefore("&")
                if (id.isBlank()) return@forEach

                val post = a.closest(".post")
                val title = post?.select(".title")?.text()?.ifBlank {
                    a.select("img").attr("alt")
                } ?: a.select("img").attr("alt")

                val image = a.select("img").attr("src")
                if (title.isNotBlank()) {
                    results.add(
                        newMovieSearchResponse(title, createLink(id)) {
                            this.posterUrl = fixImage(image)
                        }
                    )
                }
            }

        return results.distinctBy { it.url }
    }

    override suspend fun load(url: String): LoadResponse {
        // Category browse page
        if (url.contains("category=")) {
            return loadCategory(url)
        }

        val id = extractId(url)
        val session = getSession()

        try {
            app.post(
                "$mainUrl/command.php",
                data = mapOf("id" to id, "type" to "visit"),
                headers = getHeaders() + mapOf(
                    "Content-Type" to "application/x-www-form-urlencoded; charset=UTF-8"
                )
            )
        } catch (_: Exception) {
        }

        val playerUrl = "$mainUrl/player.php?session=$session&play=$id"
        val document = app.get(playerUrl, headers = getHeaders()).document
        val modal = document.select(".modal-dialog")

        var title = modal.select(".modal-title").text().ifBlank {
            document.title().replace("ICC FTP SERVER", "").trim()
        }
        var poster = ""
        var year: Int? = null
        var genre = ""
        var description = ""
        var category = ""
        val videoUrls = mutableListOf<String>()

        modal.select("table.ewTable tr").forEach { row ->
            val cells = row.select("td")
            if (cells.size >= 2) {
                val label = cells[0].text().trim().replace(":", "")
                val value = cells[1].text().trim()
                when (label) {
                    "Generic Name" -> genre = value
                    "Category" -> category = value
                    "Year" -> year = value.toIntOrNull()
                    "Discription", "Description" -> description = value
                }
            }
        }

        poster = modal.select("img").attr("src")?.let { fixImage(it) } ?: ""

        modal.select("a[href]").forEach { link ->
            val href = link.attr("href")
            if (href.contains(".mp4") || href.contains(".mkv") || href.contains(".avi")) {
                val full = if (href.startsWith("http")) href else "$mainUrl/$href"
                videoUrls.add(full)
            }
        }

        if (videoUrls.isEmpty()) {
            document.select("video source, video").forEach { el ->
                val src = el.attr("src").ifBlank { el.attr("data-src") }
                if (src.isNotBlank()) {
                    videoUrls.add(if (src.startsWith("http")) src else "$mainUrl/$src")
                }
            }
        }

        val tags = genre.split(",").map { it.trim() }.filter { it.isNotBlank() }
        val isSeries = title.contains("Season", true) ||
            title.contains("Episode", true) ||
            category.contains("Serials", true)

        return if (isSeries) {
            newTvSeriesLoadResponse(
                name = title,
                url = url,
                type = TvType.TvSeries,
                episodes = getEpisodes(document, id)
            ) {
                this.posterUrl = poster
                this.plot = description
                this.year = year
                this.tags = tags
            }
        } else {
            // Store all urls joined so loadLinks can use them
            val dataUrl = if (videoUrls.isNotEmpty()) {
                videoUrls.joinToString("||")
            } else {
                playerUrl
            }
            newMovieLoadResponse(
                name = title,
                url = url,
                type = TvType.Movie,
                dataUrl = dataUrl
            ) {
                this.posterUrl = poster
                this.plot = description
                this.year = year
                this.tags = tags
            }
        }
    }

    private suspend fun loadCategory(url: String): LoadResponse {
        val document = app.get(url, headers = getHeaders()).document
        val session = getSession()
        val catName = document.select(".dropdown-toggle").firstOrNull()?.text()?.trim()
            ?: "Category"

        val episodes = mutableListOf<Episode>()
        document.select(".post a.image[href*='play='], .post-wrapper > a[href*='play=']")
            .forEachIndexed { index, a ->
                val href = a.attr("href")
                val id = href.substringAfter("play=").substringBefore("&")
                if (id.isBlank()) return@forEachIndexed

                val post = a.closest(".post")
                val title = post?.select(".title")?.text()?.ifBlank {
                    a.select("img").attr("alt")
                } ?: a.select("img").attr("alt")

                val image = a.select("img").attr("src")
                if (title.isNotBlank()) {
                    episodes.add(
                        newEpisode(createLink(id)) {
                            this.name = title
                            this.episode = index + 1
                            this.posterUrl = fixImage(image)
                        }
                    )
                }
            }

        return newTvSeriesLoadResponse(
            name = catName,
            url = url,
            type = TvType.TvSeries,
            episodes = episodes
        )
    }

    override suspend fun loadLinks(
        data: String,
        isCasting: Boolean,
        subtitleCallback: (SubtitleFile) -> Unit,
        callback: (ExtractorLink) -> Unit
    ): Boolean {
        val videoCandidates = mutableListOf<String>()

        when {
            data.contains("||") -> {
                videoCandidates.addAll(data.split("||").map { it.trim() }.filter { it.isNotBlank() })
            }
            data.contains(".mp4") || data.contains(".mkv") || data.contains(".avi") -> {
                videoCandidates.add(data)
            }
            else -> {
                val id = extractId(data)
                if (id.isNotBlank()) {
                    val session = getSession()
                    val playerUrl = "$mainUrl/player.php?session=$session&play=$id"
                    val document = app.get(playerUrl, headers = getHeaders()).document

                    document.select(".modal-dialog a[href], a[href*='.mp4'], a[href*='.mkv']")
                        .forEach { link ->
                            val href = link.attr("href")
                            if (href.contains(".mp4") || href.contains(".mkv") || href.contains(".avi")) {
                                videoCandidates.add(
                                    if (href.startsWith("http")) href else "$mainUrl/$href"
                                )
                            }
                        }
                    document.select("video source, video").forEach { el ->
                        val src = el.attr("src").ifBlank { el.attr("data-src") }
                        if (src.isNotBlank()) {
                            videoCandidates.add(
                                if (src.startsWith("http")) src else "$mainUrl/$src"
                            )
                        }
                    }
                }
            }
        }

        var found = false
        for (videoUrl in videoCandidates.distinct()) {
            val quality = extractQuality(videoUrl) ?: Qualities.Unknown.value
            callback.invoke(
                newExtractorLink(
                    source = name,
                    name = "ICC FTP",
                    url = videoUrl,
                    type = ExtractorLinkType.VIDEO
                ) {
                    this.quality = quality
                    this.referer = mainUrl
                    this.headers = mapOf(
                        "Referer" to "$mainUrl/",
                        "User-Agent" to "Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36",
                        "Range" to "bytes=0-"
                    )
                }
            )
            found = true
        }
        return found
    }

    private suspend fun getEpisodes(document: Document, currentId: String): List<Episode> {
        val episodes = mutableListOf<Episode>()
        val seen = mutableSetOf<String>()

        document.select(".post a.image[href*='play='], .post-wrapper > a[href*='play=']")
            .forEach { a ->
                val href = a.attr("href")
                val epId = href.substringAfter("play=").substringBefore("&")
                if (epId.isBlank() || epId == currentId || !seen.add(epId)) return@forEach

                val post = a.closest(".post")
                val title = post?.select(".title")?.text()?.ifBlank {
                    a.select("img").attr("alt")
                } ?: a.select("img").attr("alt")

                val season = Regex("Season\\s*(\\d+)", RegexOption.IGNORE_CASE)
                    .find(title)?.groupValues?.get(1)?.toIntOrNull()
                    ?: Regex("S(\\d+)E", RegexOption.IGNORE_CASE)
                        .find(title)?.groupValues?.get(1)?.toIntOrNull()
                    ?: 1
                val episode = Regex("Episode\\s*(\\d+)", RegexOption.IGNORE_CASE)
                    .find(title)?.groupValues?.get(1)?.toIntOrNull()
                    ?: Regex("S\\d+E(\\d+)", RegexOption.IGNORE_CASE)
                        .find(title)?.groupValues?.get(1)?.toIntOrNull()
                    ?: Regex("E(\\d+)", RegexOption.IGNORE_CASE)
                        .find(title)?.groupValues?.get(1)?.toIntOrNull()
                    ?: episodes.size + 1

                episodes.add(
                    newEpisode(createLink(epId)) {
                        this.name = title
                        this.season = season
                        this.episode = episode
                        this.posterUrl = fixImage(a.select("img").attr("src"))
                    }
                )
            }

        return episodes.sortedWith(compareBy({ it.season }, { it.episode }))
    }

    private suspend fun getSession(): String {
        currentSession?.let { if (it.isNotBlank()) return it }

        val response = app.get(
            mainUrl,
            headers = mapOf(
                "User-Agent" to "Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36",
                "Referer" to "http://10.16.100.202/"
            )
        )
        val html = response.text
        currentSession = Regex("session=([a-f0-9]{20,})")
            .find(html)?.groupValues?.get(1)
            ?: response.cookies["PHPSESSID"]
            ?: ""

        return currentSession ?: ""
    }

    private suspend fun getToken(session: String): String {
        currentToken?.let { if (it.isNotBlank()) return it }

        val url = "$mainUrl/dashboard.php?session=$session&category=0"
        val html = app.get(url, headers = getHeaders()).text
        currentToken = Regex("name=\"token\"\\s+value=\"([^\"]+)\"")
            .find(html)?.groupValues?.get(1)
            ?: ""

        return currentToken ?: ""
    }

    private fun getHeaders(): Map<String, String> {
        return mapOf(
            "User-Agent" to "Mozilla/5.0 (Linux; Android 12; SM-M025F Build/SP1A.210812.016) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
            "Accept" to "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language" to "en-GB,en-US;q=0.9,en;q=0.8",
            "Referer" to "$mainUrl/",
            "X-Requested-With" to "com.mycompany.app.soulbrowser"
        )
    }

    private fun createLink(id: String): String {
        val session = currentSession ?: ""
        return if (session.isNotEmpty()) {
            "$mainUrl/player.php?session=$session&play=$id"
        } else {
            "$mainUrl/player.php?play=$id"
        }
    }

    private fun extractId(url: String): String {
        return url.substringAfter("play=").substringBefore("&")
    }

    private fun fixImage(path: String?): String? {
        if (path.isNullOrBlank()) return null
        return if (path.startsWith("http")) path else "$mainUrl/$path"
    }

    private fun extractQuality(text: String?): Int? {
        if (text.isNullOrEmpty()) return null
        val lower = text.lowercase()
        for ((pattern, quality) in QUALITY_PATTERNS) {
            if (lower.contains(pattern)) return quality
        }
        return null
    }
}