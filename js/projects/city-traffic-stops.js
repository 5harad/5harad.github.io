---
---
!function(global) {
  
  
  
function initStopsMap(d3, targetContainerSelector) {


// -- Constants --------------------------------------------------------------

/**
 * Options set in the URL.
 */
const OPTS = parseSearch(global.location.search);

/**
 * Viz palette.
 */
const PALETTE = {
    blue: "#0078B8",
    orange: "#FF7E00",
    green: "#00A820",
    red: "#E81D2B",
    magenta: "#9c27b0",
};

/**
 * Scale used for race in viz.
 */
const RACE_SCALE = {
    white: PALETTE.blue,
    black: PALETTE.orange,
    hispanic: PALETTE.green,
    "asian/pacific islander": PALETTE.red,
    "other/unknown": PALETTE.magenta,
    "": PALETTE.magenta,
};

/**
 * Config option to suppress the population panel.
 */
const SUPPRESS_POP_MAP = OPTS.get("nopop");



// -- Utilites ---------------------------------------------------------------

/**
 * Parse the search string in the URL.
 */
function parseSearch(s) {
    const hash = new Map();
    const base = s[0] === "?" ? s.substring(1) : s;
    const arr = base.split("&");
    for (let slug of arr) {
        const split = slug.split("=");
        const n = split.length;
        const [k, v] = split;
        // boolean
        if (n === 1) {
            hash.set(k, true);
        } else if (hash.has(k)) {
            const existing = hash.get(k);
            if (!Array.isArray(existing)) {
                hash.set(k, [existing]);
            }
            hash.get(k).push(v);
        } else {
            hash.set(k, v);
        }
    }
    return hash;
}

/**
 * Select color based on race string.
 */
function getRaceColor(race) {
    if (!RACE_SCALE.hasOwnProperty(race)) {
        console.warn("Missing race scale:", race);
    }
    return RACE_SCALE[race];
}

/**
 * Select color based on race property of GeoJSON feature.
 */
function colorByRace(d) {
    const race = d.properties.subject_race;
    return getRaceColor(race);
}

/**
 * Show an error message.
 */
function showError(e) {
    const el = document.createElement("div");
    el.className = "viz-error";
    el.innerHTML = `
        <div>
            <div>
                An error occurred: ${e.message}
            </div>
            <div>
                Try <a href='javascript:window.location.reload();'>reloading</a> the page?
            </div>
        </div>
    `;

    document.body.appendChild(el);
}



// -- Loading and processing -------------------------------------------------

/**
 * Data loading and processing.
 */
class Loader {
    
    constructor() {
        /**
         * Cache of promises for city data requests.
         */
        this.CACHE = {};

        this.stopJitter = 0.002;
        this.popJitter = 0.005;
        this.races = ["black", "white", "hispanic", "asian/pacific islander", "other/unknown"];
        this._firstCity = null;
    }

    /**
     * Load sources and transform to GeoJSON.
     */
    loadCityData(city) {
        const {CACHE} = this;
        const citySlug = this.getPathSlugFromCity(city);
        const key = citySlug + ".agg";
        if (CACHE.hasOwnProperty(key)) {
            return CACHE[key];
        }

        const p = Promise.all([
                d3.json(sameHost('/assets/data/citysamples/agg/' + citySlug + '.json')),
                d3.json(sameHost('/assets/data/citysamples/pop/' + citySlug + '.json')),
            ])
            .then(data => ({
                stop: this.formatGeoJson(data[0], {jitter: this.stopJitter}),
                pop: this.formatGeoJson(this.disaggregateRace(data[1]), {jitter: this.popJitter}),
            }))
            .then(data => {
                const dateAccessor = data.stop.date.accessor;
                data.range = [dateAccessor(data.stop.date.bottom(1)[0]), dateAccessor(data.stop.date.top(1)[0])];
                return data;
            });

        CACHE[key] = p;

        return p;
    }
    
    /**
     * Load a single day of data for the given city.
     */
    loadCityDayData(city) {
        const {CACHE} = this;
        const citySlug = this.getPathSlugFromCity(city);
        const key = citySlug + ".day";
        if (CACHE.hasOwnProperty(key)) {
            return CACHE[key];
        }

        const p = d3.json(sameHost('/assets/data/citysamples/day/' + citySlug + '.json'))
            .then(d => this.formatGeoJson(d, {jitter: this.stopJitter}))
            .then(d => {
                d.date = new Date(d.time.top(1)[0].properties.date);
                return d;
            });

        CACHE[key] = p;

        return p;
    }

    /**
     * Load metadata about what cities are available.
     */
    loadManifest() {
        if (this.CACHE.__manifest) {
            return this.CACHE.__manifest;
        }

        const p = d3.json(sameHost('/assets/data/citysamples/cities.json'))
            .then(manifest => {
                manifest.cities = manifest.cities
                    // Drop cities that were explicitly hidden
                    .filter(city => !city.hidden)
                    // Sort by state name, then city
                    .sort((a, b) => a.state + a.city < b.state + b.city ? -1 : 1);
                return manifest;
            });

        this.CACHE.__manifest = p;

        return p;
    }

    /**
     * Kick off data loading for manifest and the first city in the manifest.
     */
    preload() {
        return this.loadManifest()
            .then(manifest => {
                const philly = manifest.cities.find(d => d.city === "Philadelphia");
                this.loadCityData(philly);
                this._firstCity = philly;
                return manifest;
            });
    }

    /**
     * Get the default city selection.
     */
    firstCity() {
        if (!this._firstCity) {
            throw new Error("Manifest not loaded");
        }
        return this._firstCity;
    }

    /**
     * Get path slug from city object.
     */
    getPathSlugFromCity(city) {
        return (city.state + "-" + city.city.replace(/\s/g, "_")).toLowerCase();
    }

    /**
     * Format the remote JSON data as GeoJSON.
     */
    formatGeoJson(json, opts) {
        opts = opts || {};
        const jitter = opts.jitter || 0;
        const latIdx = json.cols.indexOf("lat");
        const lonIdx = json.cols.indexOf("lng");

        const features = [];
        json.rows.map(row => {
            let propObj;
            // Read extra props beyond lat/lon
            if (json.cols.length > 2) {
                propObj = {};
                json.cols.map((p, i) => {
                    if (i !== latIdx && i !== lonIdx) {
                        propObj[p] = row[i];
                    }
                });
            }

            let lat = row[latIdx];
            let lon = row[lonIdx];

            // Ignore features with NAs in lat or lng
            if (!lat || !lon) {
                return;
            }

            if (jitter) {
                // Take a random angle around the circle
                const theta = Math.random() * 2 * Math.PI;
                // Take a random distance along the radius of the circle
                const radius = Math.random() * jitter;
                lat = lat + radius * Math.cos(theta);
                lon = lon + radius * Math.sin(theta);
            }

            features.push({
                "type": "Feature",
                "properties": propObj,
                "geometry": {
                    "type": "Point",
                    "coordinates": [lon, lat],
                },
            });
        });

        const filter = crossfilter(features);

        return {
            cf: filter,
            race: filter.dimension(d => d.properties.subject_race || "other/unknown"),
            time: filter.dimension(d => {
                if (!d.properties.hasOwnProperty("time")) {
                    return 0;
                }

                const {time} = d.properties;

                if (!time) {
                    return null;
                }

                // Parse value of time in seconds
                const [h, m, s] = d.properties.time.split(":");
                return parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(s);
            }),
            date: filter.dimension(d => {
                if (!d.properties.hasOwnProperty("date")) {
                    return new Date(0);
                }
                return new Date(d.properties.date);
            }),
        };
    }

    /**
     * Create one row for the number of counts of each race.
     *
     * By default, draws 10,000 dots.
     */
    disaggregateRace(data, n) {
        n = n || 10000;
        const newData = {cols: ["lat", "lng", "tract", "subject_race"], rows: []};
        const races = this.races;
        
        // Find column indexes for race keys
        const racesWithIdx = races.map(race => {
            const index = data.cols.indexOf(race);
            if (index < 0) {
                console.error("Race not found in column headers" + race);
            }
            return [race, data.cols.indexOf(race)];
        });

        // Compute total population represented by file
        const totalPop = data.rows.reduce((agg, row) => {
            racesWithIdx.forEach(([_, idx]) => {
                agg += row[idx] || 0;
            });
            return agg;
        }, 0);

        // Scale such that `n` points are drawn
        const downsample = Math.min(1, n / totalPop);

        const latIdx = data.cols.indexOf("lat");
        const lngIdx = data.cols.indexOf("lng");
        const tractIdx = data.cols.indexOf("tract");

        // Create approximately `n` rows
        for (let i = 0; i < data.rows.length; i++) {
            const row = data.rows[i];
            for (let j = 0; j < racesWithIdx.length; j++) {
                const raceData = racesWithIdx[j];
                const [raceName, colIdx] = raceData;
                const lat = row[latIdx];
                const lng = row[lngIdx];
                const tract = row[tractIdx];
                for (let x = 0; x < row[colIdx] * downsample; x++) {
                    newData.rows.push([lat, lng, tract, raceName]);
                }
            }
        }

        return newData;
    }

}



// -- Rendering --------------------------------------------------------------

/**
 * Visualization that shows density over a single day.
 */
class Timeline {

    constructor(selector, dim, n, date) {
        this.render = this.render.bind(this);
        this._drag = this._drag.bind(this);
        this._click = this._click.bind(this);
        this._togglePlaying = this._togglePlaying.bind(this);
        
        // Config
        this.height = 80;
        const granularity = 0.25; // hours

        // Compute layout features / state

        // Compute timeline data, ensuring that 0-points are filled into the group.
        const tdMap = new Map(d3.range(0, 24, granularity).map(x => [x, 0]));
        dim
            .group(d => Math.floor(d / (3600 * granularity)) * granularity)
            .all()
            .map(({key, value}) => tdMap.set(key, value));
        this.timelineData = Array.from(tdMap.entries()).map(([key, value]) => ({key, value}));

        // Compute marks for each stop
        this.timeMarkData = Array.from(
            dim.bottom(Infinity)
                .reduce((m, point) => {
                    const race = point.properties.subject_race;
                    if (!m.has(race)) {
                        m.set(race, {race, points: [], height: 5});
                    }
                    m.get(race).points.push(dim.accessor(point) / 3600);
                    return m;
                }, new Map())
                .values()
        );
        const max = d3.max(this.timelineData, d => d.value);
        this.tX = d3.scaleLinear().domain([0, 24 - granularity])
        this.tY = d3.scaleLinear().domain([0, max]).range([this.height, 0]);
        this._playing = false;

        // Init dom
        this._timeAreaContainer = d3.select(selector)
            .append("div")
            .attr("id", "time-area")
            .style("height", `${this.height}px`);
        this._timeArea = this._timeAreaContainer.append("svg")
            .on("click", this._click);
        this._controlsContainer = d3.select(selector)
            .append("div")
            .attr("id", "time-control");
        this._controls = this._controlsContainer
            .append("i")
            .on("click", this._togglePlaying);
        this._timeLabel = d3.select(selector)
            .append("div")
            .attr("id", "time-label");
        this._dateLabel = d3.select(selector)
            .append("div")
            .attr("id", "date-label")
            .text(`Viewing ${n} stops that occurred on ${date.toUTCString().substring(0, 16)}`);
        this._timeAreaPointer = this._timeArea.append("line")
            .attr("class", "pointer")
            .attr("x1", this.tX(0))
            .attr("x2", this.tX(0))
            .attr("y1", this.height)
            .attr("y2", 0)
            .call(d3.drag().on("drag", this._drag));
    }

    container() {
        return this._timeAreaContainer.node();
    }

    setPlaying(b) {
        this._playing = b;
        this._controls.attr("class", b ? "fa fa-pause" : "fa fa-play");
    }

    /**
     * Render the visualization.
     */
    render() {
        const {width} = this._timeAreaContainer.node().parentNode.getBoundingClientRect();
        this.tX.range([0, width]);
        this._timeArea.attr("width", width).attr("height", this.height);
        const t = this._timeArea.selectAll(".timeline").data([this.timelineData]);
        t.enter().append("path").attr("class", "timeline");
        const timeline = d3.area()
            .x(d => this.tX(d.key))
            .y0(this.height)
            .y1(d => this.tY(d.value));
        this._timeArea.selectAll(".timeline").attr("d", timeline);

        const m = this._timeArea.selectAll(".marks").data(this.timeMarkData);
        m.enter().append("path").attr("class", "marks");
        m.exit().remove();
        this._timeArea.selectAll(".marks")
            .attr("d", d => {
                const y0 = this.height;
                const height = d.height || this.height / 10;
                const y1 = this.height - height;
                return d.points.map(p => {
                    const x = this.tX(p);
                    return `M${x},${y0} L${x},${y1}`;
                }).join(" ");
            })
            .style("stroke", d => getRaceColor(d.race))
            .style("opacity", 0.5)

        // move pointer to front
        this._timeArea.selectAll(".pointer").each(function() { this.parentNode.appendChild(this); });
    }

    /**
     * Update the marker position. Input is number of seconds since midnight.
     */
    updateMarker(s) {
        const h = s / 3600;
        const x = this.tX(h);
        this._timeAreaPointer.attr("x1", x).attr("x2", x);
        this.updateTimeLabel(s);
    }

    /**
     * Update the label with the current time.
     */
    updateTimeLabel(seconds) {
        const hour = Math.floor(seconds / 3600);
        const minute = Math.floor((seconds % 3600) / 60);
        const ampm = hour >= 12 && hour < 24 ? "pm" :"am";
        const shortHr = hour % 12;
        const fmtHr = shortHr === 0 ? "12" : shortHr < 10 ? " " + shortHr : "" + shortHr;
        const fmtMin = minute < 10 ? "0" + minute : "" + minute;
        this._timeLabel.text(`${fmtHr}:${fmtMin}${ampm}`);
    }

    /**
     * Dispose of this component.
     */
    remove() {
        this._controlsContainer.remove();
        this._timeArea.remove();
        this._timeLabel.remove();
        this._timeAreaContainer.remove();
        this._dateLabel.remove();
    }

    _click() {
        if (!this.onclick) {
            return;
        }
        this.onclick(this._currentMousePos());
    }

    _drag() {
        if (!this.ondrag) {
            return;
        }
        this.ondrag(this._currentMousePos());
    }

    _currentMousePos() {
        const el =this._timeArea.node();
        const [x, _] = d3.mouse(el);
        // Get hour position of mouse
        const h = this.tX.invert(x); 
        // Convert to seconds
        const s = h * 3600;
        // Clamp to range
        return Math.max(0, Math.min(s, 86400));
    }

    _togglePlaying() {
        const p = this._playing;
        if (!p && this.onplay) {
            return this.onplay();
        } else if (p && this.onpause) {
            return this.onpause();
        }
    }

}

class StopsAnimation {
    
    constructor(selector, map, dim, n, date, config) {
        this.config = {
            /**
             * Millseconds between updates.
             */
            interval: 250,   
            /**
             * Duration of animation (milliseconds to display full day).
             */
            duration: 1.5 * 60 * 1000, // one and half minutes
            /**
             * Milliseconds to leave rendered points on screen.
             */
            decay: 1000, // one second
            /**
             * Milliseconds to jitter rendering of simultaneous points.
             */
            renderJitter: 50,
            /**
             * Window (in seconds) of time surrounding cursor to take points
             * for rendering when `setCursor` is called.
             */
            binWidth: 10 * 60, // ten minutes
            // Allow for overriding these defaults
            ...(config || {}),
        };

        this.state = {
            // Timestamp of last point generation
            lastGenerated: 0,
            // Timestamp of last render
            lastRendered: 0,
            // Interval between now and next render
            nextRender: 0,
            // Current cursor position
            cursor: 0,
            // Animation control state
            paused: false,
            // Queue of points to render
            queue: [],
            // Project real time to seconds during the day
            scale: d3.scaleLinear()
                .domain([0, this.config.duration])
                .range([0, 86400]),
            // Timestamp of when viz was paused
            pausedTs: 0,
            // Whether viz has been destroyed
            cleared: false,
        };


        // Set up timeline, with interactions
        this._timeline = new Timeline(selector, dim, n, date); 
        this._timeline.ondrag = s => this.setCursor(s);
        this._timeline.onclick = s => this.setCursor(s);
        this._timeline.onplay = () => this.state.cursor >= 86400 ? this.start() : this.unpause();
        this._timeline.onpause = () => this.pause();
        this._timeline.container().addEventListener("mouseover", () => {
            map.dragging.disable();
        });
        this._timeline.container().addEventListener("mouseout", () => {
            map.dragging.enable();
        });
        this._timeline.render();

        // References 
        this._animationMarkers = new Set();
        this._map = map;
        this._dim = dim;
        
        // Bound methods
        this._generate = this._generate.bind(this);
        this._render = this._render.bind(this);
        this.resize = this.resize.bind(this);
    }

    /**
     * Re-render into the current size of the containers.
     */
    resize() {
        this._timeline.render();
    }

    /**
     * Pause a running animation at the current time.
     */
    pause() {
        if (this.state.paused) {
            return;
        }
        if (this.state.cleared) {
            throw new Error("Cannot pause cleared viz");
        }

        this.state.paused = true;
        this.state.pausedTs = Date.now();
        this._stopAnimations();
        this._timeline.setPlaying(false);
    }

    /**
     * Resume a paused visualization.
     */
    unpause() {
        if (!this.state.paused) {
            return;
        }
        if (this.state.cleared) {
            throw new Error("Cannot unpause cleared viz");
        }

        this.state.paused = false;
        // Add the time that the viz was paused to the reference point so that
        // the calculations remain consistent.
        const offset = Date.now() - this.state.pausedTs;
        this.state.lastGenerated += offset;
        this.state.lastRendered += offset;
        // Add the offset to all the points on screen so they decay continuously
        for (const o of this._animationMarkers) {
            o.t += offset;
        }
        this._runAnimations();
        this._timeline.setPlaying(true);
    }

    /**
     * Start (or restart) the visualization. This resets state and starts the
     * animation from the beginning.
     */
    start() {
        if (this.state.cleared) {
            throw new Error("Cannot start cleared viz");
        }

        this._clearMarkers();

        this.state = {
            ...this.state,
            paused: false,
            lastGenerated: Date.now(),
            lastRendered: Date.now(),
            nextRender: 0,
            cursor: 0,
            queue: [],
        };

        this._runAnimations();
        this._timeline.setPlaying(true);
    }

    /**
     * Set the cursor position to a specific second within the day and render
     * the stops that happened around that time. This pauses the animation if
     * it is in progress.
     */
    setCursor(s) {
        this.pause(); 
        this.state.cursor = s;
        this._clearMarkers();
        this._renderMarkersAtCurrentTime();
    }

    /**
     * Get the current cursor position
     */
    getCursor() {
        return this.state.cursor;
    }

    /**
     * Test whether animation is paused.
     */
    isPaused() {
        return this.state.paused;
    }

    /**
     * Clean up elements and animations. Animation cannot be restarted after
     * it has been destroyed (create a new one instead).
     */
    destroy() {
        if (this.state.cleared) {
            return;
        }
        this._stopAnimations();
        this._clearMarkers();
        if (this._timeline) {
            this._timeline.remove();
            this._timeline = null;
        }
        this.state.cleared = true;
    }

    _clearMarkers() {
        if (this._animationMarkers) {
            for (const o of this._animationMarkers) {
                o.m.__map.removeLayer(o.m);
                this._animationMarkers.delete(o);
            }
        }
    }

    _stopAnimations() {
        if (this._generator) {
            global.cancelAnimationFrame(this._generator);
            this._generator = null;
        }
        if (this._renderer) {
            global.cancelAnimationFrame(this._renderer);
            this._renderer = null;
        }
    }

    _runAnimations() {
        this._generator = global.requestAnimationFrame(this._generate);
        this._renderer = global.requestAnimationFrame(this._render);
    }

    _generate() {
        if (this.state.cleared) {
            return;
        }
        const now = Date.now();
        const elapsed = now - this.state.lastGenerated;
        const delta = this.state.scale(elapsed);
        const bound = this.state.cursor + delta;
        
        // Cancel the generator once 24 hours is reached. Use small buffer for
        // rendering point fadeout.
        if (bound > 87400) {
            this._generator = null;
            this.state.cursor = bound;
            this.state.lastGenerated = now;
            this.pause();
            return;
        }

        // Schedule a new generation
        this._generator = global.requestAnimationFrame(this._generate);

        if ((now - this.state.lastGenerated) < this.config.interval) {
            return;
        }

        const points = this._dim
            .filterRange([this.state.cursor, bound])
            .bottom(Infinity);

        // Add points to queue
        this.state.queue.push.apply(this.state.queue, points);
        this.state.cursor = bound;
        this.state.lastGenerated = now;
    }

    _render() {
        // Bail if the generator has stopped
        if (this.state.cleared) {
            this._renderer = null;
            return;
        }

        // Compute the current position in the viz.
        // NOTE: Calculate offset based on the generator's timestamp, since
        // that is what updates the cursor.
        const now = Date.now();
        const elapsed = now - this.state.lastGenerated;
        const sec = this.state.cursor + this.state.scale(elapsed);
        // Quit after a little more than a day. The buffer is so all the points
        // can fully decay.
        if (sec > 87400) {
            this._clearMarkers();
            this._renderer = null;
            return;
        } else if (sec <= 86400) {
            this._timeline.updateMarker(sec);
        }

        // Schedule a new render
        this._renderer = global.requestAnimationFrame(this._render);

        // Decay existing points
        for (const o of this._animationMarkers) {
            const {t, m} = o;
            const opacity = 1 - (now - t) / this.config.decay;
            if (opacity < 0) {
                this._map.removeLayer(m);
                this._animationMarkers.delete(o);
            } else {
                m.setStyle({fillOpacity: opacity});
                const tooltip = m.getTooltip();
                if (tooltip) {
                    tooltip.setOpacity(opacity);
                }
            }
        }

        // Don't add new points until next update (this adds jitter to
        // stops that happened at the same time.
        if ((now - this.state.lastRendered) < this.state.nextRender) {
            return;
        }

        // Schedule next update at a small random delay
        this.state.nextRender = Math.max(5, Math.random() * this.config.renderJitter);

        // Grab a point from the queue
        const point = this.state.queue.shift();
        if (!point) {
            return;
        }
        this._renderPoint(point);
    }

    _renderPoint(point) {
        // Create and render the new point.
        const [lon, lat] = point.geometry.coordinates;
        const marker = L.circleMarker([lat, lon], {
            color: colorByRace(point),
            radius: 5,
            fillOpacity: 1,
            stroke: 0,
        });
        // Keep a reference to the source map for cleaning up later.
        marker.__map = this._map;
        marker.addTo(this._map);

        // Add info
        const {subject_age, subject_race, subject_sex} = point.properties;
        const fields = [
            subject_age ? `${Math.floor(subject_age)} year old` : null,
            subject_race,
            subject_sex,
        ].filter(x => !!x);
        marker.bindTooltip(fields.join("<br/>"), {permanent: false});

        // Track marker with the time it was added.
        this._animationMarkers.add({t: Date.now(), m: marker});
    }

    _renderMarkersAtCurrentTime() {
        const {binWidth} = this.config;
        const {cursor} = this.state;
        const min = cursor - binWidth / 2;
        const max = cursor + binWidth / 2;
        const points = this._dim
            .filterRange([min, max])
            .bottom(Infinity);
        points.forEach(p => this._renderPoint(p));
        this._timeline.updateMarker(cursor);
    }

}

/**
 * Visualization rendering and interaction.
 */
class Viz {

    constructor(loader) {
        // Viz state
        this.stopMap = null;
        this.popMap = null;
        this.mapSet = false;
        this.vizCity = null;

        // Constants
        this.DEFAULT_ZOOM = 11;
        this.DEFAULT_RADIUS = 1.3;
        this.DEFAULT_OPACITY = 0.7;

        // Caches
        this.LAYERS = {};
        this.FILTERS = {};
        this.RESIZE_HANDLERS = [];

        this.loader = loader;
        loader.preload();
    }

    /**
     * Instantiate DOM, load data, configure and render maps.
     */
    init(root, containerSel) {
        // Create container elements
        const c = d3.select(containerSel);
        const mapIds = [
            SUPPRESS_POP_MAP ? null : "map-pop",
            "map-stop",
        ].filter(x => !!x);
        const mapEls = c.selectAll(".city-map")
            .data(mapIds)
            .enter().append("div");
        const that = this;

        mapEls
            .each(function(d) {
                d3.select(this)
                    .append("div")
                    .attr("id", d)
                    .style("width", "100%")
                    .style("height", "100%");
            })
            .attr("class", "city-map")
            .style("display", "inline-block")
            .style("margin", "1px");

        this.buildLegend();

        // Fit map to container
        function resize() {
            // Where does this number come from? *magic*
            const rect = root.getBoundingClientRect();
            const height = rect.height;
            const width = (rect.width - 4) / mapIds.length;

            // Update map containers
            mapEls
                .style("width", width + "px")
                .style("height", height + "px");

            that.RESIZE_HANDLERS.map(handler => handler(width, height));
        }
        global.addEventListener("resize", resize);
        resize();

        // Render maps
        loader.preload()
            .then(d => {
                const firstCity = loader.firstCity();
                this.initCityDropdown(d.cities, firstCity);
                this.initModeToggle();
                this.createMaps(firstCity);
                this.vizCity = firstCity;
                this.updateMap();
            })
            .catch(showError);
    }

    /**
     * Render legend blocks with the viz scale.
     */
    buildLegend() {
        const {FILTERS} = this;
        const viz = this;
        const legend = [
            ["White", "white"],
            ["Black", "black"],
            ["Hispanic", "hispanic"],
            ["Asian", "asian/pacific islander"],
            ["Unknown/other", "other/unknown"],
        ];

        const block = d3.select("#viz_legend")
            .selectAll(".block")
            .data(legend)
            .enter()
            .append("div")
            .attr("class", "block");

        block.each(function(d, i) {
            const b = d3.select(this);
            b.append("span")
                .attr("class", "swatch")
                .style("background-color", getRaceColor(d[1]));
            b.append("span").attr("class", "legend-label").text(d[0]);
        });

        block.on("click", function(d) {
            const slug = d[1];
            const disabled = FILTERS[slug];
            if (!disabled) {
                this.classList.add("filter-disabled");
                FILTERS[slug] = true;
            } else {
                this.classList.remove("filter-disabled");
                FILTERS[slug] = false;
            }
            viz.updateMap();
        });
    }

    initModeToggle() {
        const update = () => {
            this.updateEnabledFeatures();
            this.updateMap();
        };
        document.querySelector("#mode-agg").onchange = update;
        document.querySelector("#mode-day").onchange = update;
    }

    updateEnabledFeatures() {
        const currentCity = this.vizCity;

        // Ensure current city is in agg mode if time is not available
        if (!currentCity.time) {
            document.querySelector("#mode-agg").checked = true;
            document.querySelector("#mode-day").disabled = true;
        } else {
            document.querySelector("#mode-day").disabled = false;
        }

        // Disable dropdown options for cities without time
        const isAggMode = document.querySelector("#mode-agg").checked;
        d3.selectAll(".city-dropdown option")
            .attr("disabled", d => (!isAggMode && !d.time) ? true : null);
    }

    /**
     * Add available cities to dropdown.
     */
    initCityDropdown(cityData, firstCity) {
        const dropdown = d3.select(".city-dropdown")
            .on("change", (d, a, s) => {
                const idx = s[0].value;
                this.vizCity = cityData[idx];
                this.updateEnabledFeatures();
                this.updateMap();
            });

        dropdown.selectAll("option")
            .data(cityData)
            .enter().append("option")
            .attr("value", (d, i) => i)
            .text(d => d.city + ", " + d.state);

        dropdown.node().value = cityData.findIndex(d => d === firstCity);

        this._dropdown = dropdown;
    }

    /**
     * Update map with current city's data
     */
    updateMap() {
        this.clearMapLayers();
        // If there's a current animation running in the current city,
        // transition its state.
        let cursor, paused;
        if (this._animationViz && this._animationVizCity === this.vizCity) {
            cursor = this._animationViz.getCursor();
            paused = this._animationViz.isPaused();
        }
        this.clearStopsAnimation();
        this.toggleLoading(true);
        const aggMode = document.querySelector("#mode-agg").checked;

        if (aggMode) {
            // Render the aggregate data
            this.loader.loadCityData(this.vizCity)
                .then(d => {
                    if (!SUPPRESS_POP_MAP) {
                        this.renderOverlay(this.popMap, d.pop, colorByRace);
                    }
                    this.renderOverlay(this.stopMap, d.stop, colorByRace);
                    this.renderAggLabel("#map-stop", d.range);
                    this.moveMapToCity(this.stopMap, this.vizCity);
                    this.toggleLoading(false);
                })
                .catch(showError);
        } else {
            // Render the day of stops animation
            this.loader.loadManifest()
                .then(() => Promise.all([
                    this.loader.loadCityData(this.vizCity),
                    this.loader.loadCityDayData(this.vizCity),
                ]))
                .then(([agg, day]) => {
                    if (!SUPPRESS_POP_MAP) {
                        this.renderOverlay(this.popMap, agg.pop, colorByRace);
                    }
                    this.runStopsAnimation("#map-stop", this.stopMap, day, cursor, paused);
                    this._animationVizCity = this.vizCity;
                    this.moveMapToCity(this.stopMap, this.vizCity);
                    this.toggleLoading(false);
                });
        }
    }

    renderAggLabel(selector, range) {
        const el = d3.select(selector).selectAll(".agg-label").data([range]);
        el.enter().append("div").attr("class", "agg-label");
        el.exit().remove();
        el.text(d => {
            if (!d) {
                return "";
            }
            const [y0, y1] = d.map(d => d.getUTCFullYear());
            return y0 === y1 ? y0 : `${y0} - ${y1}`;
        });
    }

    clearStopsAnimation() {
        if (this._animationViz) {
            this._animationViz.destroy();
            this.RESIZE_HANDLERS = this.RESIZE_HANDLERS.filter(r => r !== this._animationViz.resize);
            this._animationViz = null;
            this._animationVizCity = null;
        }
    }

    runStopsAnimation(selector, map, data, startAt, paused) {
        data.time.filterAll();
        this.applyFilters(data);
        const n = data.time.top(Infinity).length;
        this._animationViz = new StopsAnimation(selector, map, data.time, n, data.date);
        this.RESIZE_HANDLERS.push(this._animationViz.resize);
        this._animationViz.start();
        // Apply state continuations
        if (startAt) {
            this._animationViz.setCursor(startAt);
            if (!paused) {
                this._animationViz.unpause();
            }
        }
    }
 
    /**
     * Show or hide the loading indicator.
     */
    toggleLoading(show) {
        if (show) {
            global.document.body.classList.add("viz-is-loading");
        } else {
            global.document.body.classList.remove("viz-is-loading");
        }
    }

    /**
     * Configure and render the map elements.
     */
    createMaps(city) {
        this.stopMap = this.initMap("map-stop");
        this.addMapPaneLabel(this.stopMap, "Stops");
        if (!SUPPRESS_POP_MAP) {
            this.popMap = this.initMap("map-pop");
            this.addMapPaneLabel(this.popMap, "Population");
            // sync map interactions
            this.stopMap.sync(this.popMap);
            this.popMap.sync(this.stopMap);
            this.popMap.removeControl(this.popMap.zoomControl);
        }
    }

    /**
     * Remove data layers already rendered on maps.
     */
    clearMapLayers() {
        const {LAYERS} = this;
        let layer;
        for (let k in LAYERS) {
            if (LAYERS.hasOwnProperty(k)) {
                while (layer = LAYERS[k].dot.pop()) {
                    LAYERS[k].map.removeLayer(layer);
                }
            }
        }
        // Clear the agg label
        this.renderAggLabel("#map-stop", null);
    }

    /**
     * Apply UI filters to data set
     */
    applyFilters(data) {
        data.race.filter(d => !this.FILTERS[d]);
    }

    /**
     * Render data on map.
     */
    renderOverlay(map, data, getColor) {
        const radius = this.getRadius();
        this.applyFilters(data);
        const layer = L.geoJSON({
            type: "FeatureCollection",
            features: data.race.top(Infinity),
        }, {
            pointToLayer: (feature, latLon) => {
                const color = getColor(feature);
                const marker = L.circleMarker(latLon, {
                    interactive: false,
                    stroke: false,
                    radius: radius,
                    fillColor: color,
                    fillOpacity: this.DEFAULT_OPACITY,
                });
                return marker;
            }
        });

        this.LAYERS[map.__mapId].dot.push(layer);
        layer.addTo(map);
    }

    /**
     * Add a caption to the map pane.
     */
    addMapPaneLabel(map, label) {
        const el = document.createElement("div");
        el.className = "map-pane-label";
        el.innerHTML = label;
        map.getContainer().appendChild(el);
    }

    /**
     * Get dot radius appropriate for zoom level.
     */
    getRadius() {
        if (!this.stopMap) {
            return this.DEFAULT_RADIUS;
        }
        const zoom = this.stopMap.getZoom();
        const zoomRat = Math.max(1, 1.05 * zoom / this.DEFAULT_ZOOM);
        return this.DEFAULT_RADIUS * zoomRat;
    }

    /**
     * Initialize Leaflet map with styles in the element with the given ID.
     */
    initMap(mapId) {
       const map = L.map(mapId, {
            preferCanvas: true,
            zoomSnap: 0.5,
            zoomDelta: 0.5,
            zoomControl: true,
            attributionControl: false,
            scrollWheelZoom: true,
            touchZoom: true,
            dragging: true,
            doubleClickZoom: true,
            tap: false,
        });

        map.__mapId = mapId;
        this.LAYERS[mapId] = {
            dot: [],
            map: map,
        };

        map.setView([0, 0], this.DEFAULT_ZOOM);
        map.zoomControl.setPosition("topright");
        map.on("zoomend", () => {
            const dotLayers = this.LAYERS[mapId].dot;
            if (dotLayers.length > 0) {
                const radius = this.getRadius();
                dotLayers.forEach(layer => {
                    layer.eachLayer(dot => {
                        dot.setRadius(radius);
                    });
                });
            }
        });

        L.tileLayer('https://api.mapbox.com/styles/v1/{domain}/{id}/tiles/256/{z}/{x}/{y}?access_token={access_token}', {
            attribution: 'Mapbox',
            domain: 'scpl',
            id: 'cjrtzfw3o01ai1fqncrz60mgf', // dark 
            // id: 'cjoqajiem9wo92spzq4frkvhq', // nash
            minZoom: 9,
            maxZoom: 13,
            access_token: 'pk.eyJ1Ijoic2NwbCIsImEiOiJjam9wZWdlYnEwMGptM3B0Y3dlNTcxeTJkIn0.Naea439zyFfsDduZvlzPsQ',
        }).addTo(map);

        return map;
    }

    /**
     * Center the map at the given city.
     */
    moveMapToCity(map, city) {
        const center = [city.center.lat, city.center.lon];

        // First time initialization: can't animate yet
        let zoom;

        if (!this.mapSet) {
            zoom = this.DEFAULT_ZOOM;
            this.mapSet = true;
            map.setView(center, zoom);
            return;
        } else {
            // Don't move the map if the city center is on the screen.
            if (map.getBounds().contains(center)) {
                return;
            }
            zoom = map.getZoom();
            // TODO(jnu): nice-looking fly-to?
            map.setView(center, zoom);
        }
    }

}


// Disable mutation observers because it kills SVG rendering performance.
if (global.FontAwesomeConfig) {
    global.FontAwesomeConfig.observeMutations = false;
}

const _root = document.querySelector(targetContainerSelector);

// Inject markup
_root.innerHTML = `
  <div class="viz_section">
      <div class="viz_section_header">
          <div class="section_title">City traffic stops</div>
          <div id="viz_controls">
              <select name="city" class="city-dropdown"></select> 
          </div>
          <div class="mode_toggle">
              <div>
                  <div>
                  <input type="radio" id="mode-agg" name="mode" value="agg" checked />
                  <label for="mode-agg">Aggregated stops<span id="date-range"></span></label>
                  </div>
                  <div>
                  <input type="radio" id="mode-day" name="mode" value="day" />
                  <label for="mode-day">Play single day</label>
                  </div>
              </div>
          </div>
          <div class="viz_legend_container">
              <label>Legend (click to filter)</label>
              <div id="viz_legend"></div>
          </div>
      </div>
      <div class="viz_section_body">
          <div id="city-map-container"></div>
      </div>
  </div> 
  <div id="viz-loader">
      <div>Loading ...</div>
  </div>
`;

// Init objects
const loader = new Loader();
const viz = new Viz(loader);
viz.init(_root, "#city-map-container");

// Expose stuff globally for debugging
global.scpl = (global.scpl || {});
global.scpl.opp = (global.scpl.opp || {});
global.scpl.opp.loader = loader;
global.scpl.opp.viz = viz;


// End wrapper
}


// Load external scripts dynamically
function loadScript(src, integrity) {
  const deferred = {resolve: null, reject: null};
  const p = new Promise((resolve, reject) => {
    deferred.resolve = resolve;
    deferred.reject = reject;
  });

  const s = document.createElement("script");
  s.type = "text/javascript";
  s.crossOrigin = "anonymous";
  s.async = true;
  s.integrity = integrity;
  s.src = src;
  if (s.readyState) {
    s.onreadystatechange = function() {
      if (s.readyState === "loaded" || s.readyState === "complete") {
        s.onreadystatechange = null;
        deferred.resolve();
      }
    };
  } else {
    s.onload = function() {
      deferred.resolve();
    };
  }

  // Start loading
  document.head.appendChild(s);

  return p;
}


// Load a stylesheet
function loadStyle(src, integrity) {
  const deferred = {resolve: null, reject: null};
  const p = new Promise((resolve, reject) => {
    deferred.resolve = resolve;
    deferred.reject = reject;
  });

  const s = document.createElement("link");
  s.rel = "stylesheet";
  s.type = "text/css";
  s.crossOrigin = "anonymous";
  s.integrity = integrity;
  s.href = src;
  s.async = true;
  s.onload = function() {
    deferred.resolve();
  };

  document.head.appendChild(s);

  return p;
}


// Load a file hosted on the same host as this script.
let __origin = "";
function sameHost(path) {
  if (!__origin) {
    const s = document.currentScript;
    if (s && s.src) {
      const u = new URL(s.src);
      __origin = u.origin;
    }
  }

  return __origin + path;
}


// Initial loading and setup
function main() {
  const container = document.currentScript.dataset.target || "#scpl-opp-stopsMap";

  // Ensure that the right version of d3 is used, in case multiple are loaded.
  let d3 = null;

  Promise.all([
    loadScript(
      "https://cdnjs.cloudflare.com/ajax/libs/d3/5.9.0/d3.min.js",
      "sha256-HrtKYamKbH8pn0jo9POj8doCiKiegrNaVQXlRUUdCQA="
    ).then(function() {
      d3 = global.d3;
    }),
    loadScript(
      "https://unpkg.com/leaflet@1.3.4/dist/leaflet.js",
      "sha512-nMMmRyTVoLYqjP9hrbed9S+FzjZHW5gY1TWCHA5ckwXZBadntCNs8kEqAWdrb9O7rxbCaA4lKTIWjDXZxflOcA=="
    ).then(() => loadScript(
        "https://cdn.jsdelivr.net/npm/leaflet.sync@0.2.4/L.Map.Sync.js",
        "sha256-aGeM2STJXBf9rIwlwIKRqcPzrUIcW1WSHf7UXRScGRk=")
    ),
    loadScript(
      "https://cdnjs.cloudflare.com/ajax/libs/crossfilter2/1.4.6/crossfilter.min.js",
      "sha256-KWOElvqz05e5RJMjM8TG7qJ2g6Xg0nfpsTwtKAUWaOI="
    ),
    loadStyle(
      "https://unpkg.com/leaflet@1.3.4/dist/leaflet.css",
      "sha512-puBpdR0798OZvTTbP4A8Ix/l+A4dHDD0DGqYW6RQ+9jxkRFclaxxQb/SJAWZfWAkuyeQUytO7+7N4QKrDh+drA=="
    ),
    loadStyle(
      sameHost("/css/projects/city-traffic-stops.css")
    ),
  ])
  .then(() => initStopsMap(d3, container));
}

// Run
main();

}(window);
