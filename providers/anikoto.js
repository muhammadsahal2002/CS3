/**
 * AnikotoTV - Minimal test
 */

"use strict";

function getStreams(tmdbId, mediaType, season, episode) {
    return Promise.resolve([
        {
            name: "AnikotoTV-TEST",
            title: "Provider is working - " + tmdbId + " S" + season + "E" + episode,
            url: "https://cdn.watching.onl/anime/abb207957b0abc1d85a7e32ab1c4359c/0cd9cd1a7641e9ae4638c6f901c917cc/master.m3u8",
            quality: "1080p",
            headers: {
                "Referer": "https://megaplay.buzz/",
                "Origin": "https://megaplay.buzz"
            }
        }
    ]);
}

module.exports = { getStreams };