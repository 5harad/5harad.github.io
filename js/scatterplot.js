---
---
const formatPercent = d3.format("%");

// add method to d3 for moving nodes to front
d3.selection.prototype.moveToFront = function() {  
  return this.each(function(){
    this.parentNode.appendChild(this);
  });
};

/**
 * Load a CSV, returning a promise with result.
 */
function loadCsv(path) {
    return new Promise((resolve, reject) => {
        d3.csv(path, (error, data) => {
            if (error) {
                return reject(error);
            }
            resolve(data);
        });
    });
}


// variable to store states available for each rate_type
const rateTypeStates = {};

function formatData(data) {
    const spData = d3.nest()
        .key(d => d.geography)
        .key(d => d.subgeography)
        .key(d => d.subject_race)
        .map(data, d3.map);

    // set a new key on each location (in each state) for storing total stops
    spData.forEach(geo => {
        const geoObj = spData.get(geo);
        geoObj.forEach(subgeo => {
            const subGeoObj = geoObj.get(subgeo);
            // add up stops among all driver races for the location
            let total = 0;
            let stopRateTotal = 0;
            subGeoObj.forEach((key, values) => {
                total += +(values[0].stops_per_year || 0);
                stopRateTotal += +(values[0].stop_rate_n || 0);
            });
            subGeoObj.set('total_stops_per_year', total);
            subGeoObj.set('total_stop_rate_stops', stopRateTotal);
        });
    });

    return spData;
}

/**
 * Get a single row for each city/race. Use this for city-level stats
 * that don't have subgeographies, like stop rate.
 */
function uniqueSubGeo(data) {
    const out = [];
    const visited = new Set();
    for (const d of data) {
        const key = `${d.geography}-${d.subject_race}`;
        if (!visited.has(key)) {
            const clone = {...d, subgeography: ""};
            out.push(clone);
            visited.add(key);
        }
    }
    return out;
}

/**
 * Cached promise for loading data
 */
window.dataPromise = null;

/**
 * Load and format source data
 */
function loadData() {
    if (!window.dataPromise) {
        window.dataPromise = Promise.all([
            loadCsv("/assets/data/findings/state.csv"),
            loadCsv("/assets/data/findings/city.csv"),
        ]).then(([state, city]) => ({
            city: formatData(city),
            state: formatData(state),
            wholeCity: formatData(uniqueSubGeo(city)),
        }));
    }

    return window.dataPromise;
}


/**
 * Current state of visualizations / selectors
 */
window.vizState = {
    mode: {},
};

function initModeToggle() {
    const isActive = function() {
        const el = this;
        const chartName = el.dataset.chart;
        const curMode = window.vizState.mode[chartName] || "State";
        return curMode === el.dataset.value;
    };

    const updateActive = el => {
        const chartName = el.dataset.chart;
        const newMode = el.dataset.value;
        window.vizState.mode[chartName] = newMode;
    };

    const btn = d3.selectAll(".btn-mode");
    btn
        .classed("active", isActive)
        .on("click", function() {
            updateActive(this);
            btn.classed("active", isActive);
            update();         
        });
}


/**
 * Re-render visualizations with current state
 */
function update() {
    // TODO(jnu): adhere to toggle
    return loadData().then(render);
}

/**
 * Render visualizations with given data.
 */
function render(data) {
    const stopData = getDataForMode(data, 'stop_rate');
    drawChart(stopData, 'stop_rate', 40);
    fillStateSelector(stopData, 'stop_rate');

    const searchData = getDataForMode(data, 'outcome');
    drawChart(searchData, 'search_rate', 10);
    fillStateSelector(searchData, 'outcome');

    const hitData = getDataForMode(data, 'hit_rate');
    drawChart(hitData, 'hit_rate', 65);
    fillStateSelector(hitData, 'hit_rate');

    const threshData = getDataForMode(data, 'inferred_threshold');
    drawChart(threshData, 'inferred_threshold', 65);
    fillStateSelector(threshData, 'inferred_threshold');
}


function getDataForMode(allData, rateType) {
    // NOTE: stop rate chart is always city and has no subgeography
    if (rateType === "stop_rate") {
        return allData.wholeCity;
    }
    const mode = window.vizState.mode[rateType] || "State";
    return mode === "State" ? allData.state : allData.city;
}


function drawChart(data, rate_type, max_rate) {
  var div_id = "#" + rate_type + "_chart";

  const vizWidth = 450;
  const vizHeight = 450;
  $(div_id).width(vizWidth).height(vizHeight);
  
  const margin = {top: 20, right: 40, bottom: 55, left: 40};
  const width = vizWidth - margin.left - margin.right;
  const height = vizHeight - margin.top - margin.bottom;

  var x = d3.scale.linear()
      .range([0, width]);

  var y = d3.scale.linear()
      .range([height, 0]);

  var xAxis = d3.svg.axis()
      .scale(x)
      .orient("bottom")
      .innerTickSize(-height)
      .outerTickSize(0)
      .tickPadding(10)
      .ticks(6);

  var yAxis = d3.svg.axis()
      .scale(y)
      .orient("left")
      .innerTickSize(-width)
      .outerTickSize(0)
      .tickPadding(10)
      .ticks(6);

  if (rate_type == 'inferred_threshold') {
    xAxis.tickFormat(d => d + '%');
    yAxis.tickFormat(d => d + '%');
  }

  var svg = d3.select(div_id).selectAll("svg." + rate_type).data([0]);
  svg.enter()
    .append("svg")
      .attr("class", rate_type)
      .attr("width", width + margin.left + margin.right + "px")
      .attr("height", height + margin.top + margin.bottom + "px")
    .append("g")
      .attr("class", "layout")
      .attr("transform", "translate(" + margin.left + "," + margin.top + ")");

  const container = svg.select(".layout");

  x.domain([0.0, max_rate]).nice();
  y.domain([0.0, max_rate]).nice();

  var axis_labels = {
    'stop_rate': ' stops per 100 people',
    'search_rate': ' searches per 100 stops',
    'hit_rate': ' hits per 100 searches',
    'inferred_threshold': ' search threshold',
  };

  container
    .selectAll("g.x.axis").data([0]).enter()
      .append("g")
      .attr("class", "x axis")
      .attr("transform", "translate(0," + height + ")")
      .call(xAxis)
    .append("text")
      .attr("class", "label")
      .attr("x", width)
      .attr("y", -6)
      .attr("x", width / 1.75)
      .attr("y", 40)
      .style("text-anchor", "end")
      .text("White" + axis_labels[rate_type]);

  container
    .selectAll("g.y.axis").data([0]).enter()
      .append("g")
      .attr("class", "y axis")
      .call(yAxis)
    .append("text")
      .attr("class", "label")
      .attr("transform", "rotate(-90)")
      .attr("y", 6)
      .attr("dy", ".71em")
      .style("text-anchor", "end")
      .text("Minority" + axis_labels[rate_type]);

  // add diagonal line
  container
    .selectAll("line.guide-line").data([0]).enter()
      .append("line")
      .attr("x1", x.range()[0])
      .attr("y1", y.range()[0])
      .attr("x2", x.range()[1])
      .attr("y2", y.range()[1])
      .attr("class", "guide-line");
  
  // add a hidden tooltip div
  d3.select("body").selectAll(`#${rate_type}_tooltip`).data([0]).enter()
    .append('div')
      .attr('id', rate_type + '_tooltip')
      .attr('class', 'sp-tooltip')
      .style('display', 'none');

  drawDots(data, "black", rate_type, svg, x, y, max_rate);
  drawDots(data, "hispanic", rate_type, svg, x, y, max_rate);
};


function drawDots(data, race, rate_type, svg, x, y, max_rate) {

  const dotData = [];
  
  data.forEach(geo => {
    const geoObj = data.get(geo);
    geoObj.forEach(subGeo => {
      const subGeoObj = geoObj.get(subGeo)
      const whiteRate = subGeoObj.has("white") ?
          +subGeoObj.get("white")[0][rate_type] * 100 :
          0;
      const minorityRate = subGeoObj.has(race) ?
          +subGeoObj.get(race)[0][rate_type] * 100 :
          0;

      // Stops per year
      const totalStopsPerYear = rate_type === "stop_rate" ?
          subGeoObj.get('total_stop_rate_stops') :
          subGeoObj.get("total_stops_per_year");
      const minorityStopField = rate_type === "stop_rate" ? "stop_rate_n" : "stops_per_year";
      const minorityStopsPerYear = subGeoObj.has(race) ?
          +subGeoObj.get(race)[0][minorityStopField] :
          0;

      // skip if the white rate is too high
      if (0 < whiteRate && whiteRate < max_rate && 
          0 < minorityRate && minorityRate < max_rate) { 
        dotData.push(
          {
            'geography': geo,
            'subgeography': subGeo,
            'total_stops_per_year': totalStopsPerYear,
            'minority_stops_per_year': minorityStopsPerYear,
            'whiteRate': whiteRate,
            'minorityRate': minorityRate,
            'minorityRace': race
          }
        )}
    })
  });

  // manage states list
  if (!rateTypeStates[rate_type]) {rateTypeStates[rate_type] = []};

  dotData.forEach(d => {
    if (rateTypeStates[rate_type].indexOf(d.geography) == -1) {
      rateTypeStates[rate_type].push(d.geography)};
  })

  const dotGroup = svg.select(".layout").selectAll(".dots").data([0]);
  dotGroup.enter().append("g").attr("class", "dots");

  const dots = dotGroup.selectAll('.dot').filter('.' + race)
    .data(dotData)

  const tooltip = d3.select('#' + rate_type + '_tooltip')

  dots.exit().remove();
  dots.enter().append("circle");
  dots
      .attr("class", d => race + ' dot ' + cleanNameForClass(d.geography))
      .attr("r", d => {
          // calculate proportion of selected minority of total drivers
          return calcDotSize(d.minority_stops_per_year / d.total_stops_per_year );
        })
      .attr("cx", d => x(d.whiteRate))
      .attr("cy", d => y(d.minorityRate))
      .on('mouseover', function(d, i) {
        d3.select(this).classed('hover', true)
        tooltip.style('display', 'block');
        
        const roundMinorityRate = Math.round(d.minorityRate)
        const roundWhiteRate = Math.round(d.whiteRate)
        let displayRace, minorityRateLabel, whiteRateLabel;
        
        if ( d.minorityRace == 'black' ) {
            displayRace = d.minorityRace.toLowerCase()
          } else {
            displayRace = d.minorityRace;
        };

        if (roundMinorityRate == 1) {
          minorityRateLabel = rate_type.replace('_rate', '')
        } else {
          minorityRateLabel = rate_type.replace('_rate', '') + 's'
        };

        if (roundWhiteRate == 1) {
          whiteRateLabel = rate_type.replace('_rate', '')
        } else {
          whiteRateLabel = rate_type.replace('_rate', '') + 's'
        };

        // XXX(jnu): haxxx to patch the stupidest code in the world
        if (minorityRateLabel === "searchs") {
            minorityRateLabel = "searches";
        }
        if (whiteRateLabel === "searchs") {
            whiteRateLabel = "searches";
        }

        switch(rate_type) {
          case 'stop_rate':
              tooltip.html(
                "<div class='location'>"+d.geography+"</div>"+
                "<div>"+roundMinorityRate+" "+minorityRateLabel+" per 100 "+displayRace+" drivers</div>"+
                "<div>"+roundWhiteRate+" "+whiteRateLabel+" per 100 white drivers</div>"
              );
            break;
          case 'search_rate':
              tooltip.html(
                "<div class='location'>"+d.subgeography+", "+d.geography+"</div>"+
                "<div>"+roundMinorityRate+" "+minorityRateLabel+" per 100 stops of "+displayRace+" drivers</div>"+
                "<div>"+roundWhiteRate+" "+whiteRateLabel+" per 100 stops of white drivers</div>"
              );
            break;
          case 'hit_rate':
              tooltip.html(
                "<div class='location'>"+d.subgeography+", "+d.geography+"</div>"+
                "<div>"+roundMinorityRate+" "+minorityRateLabel+" per 100 searches of "+displayRace+" drivers</div>"+
                "<div>"+roundWhiteRate+" "+whiteRateLabel+" per 100 searches of white drivers</div>"
              );
            break;
          case 'inferred_threshold':
              tooltip.html(
                "<div class='location'>"+d.subgeography+", "+d.geography+"</div>"+
                "<div>"+roundMinorityRate+"% search threshold for "+displayRace+" drivers</div>"+
                "<div>"+roundWhiteRate+"% search threshold for white drivers</div>"
              );
            break;
          default:
            tooltip.html(
                "<div class='location'>"+d.subgeography+", "+d.geography+"</div>"
              );
        };

        tooltip.style('display', 'block');
        tooltip.style("left", (d3.event.pageX - 30) + "px")
        tooltip.style("top", (d3.event.pageY - 80) + "px");
      })
      .on('mouseout', function(d, i) {
        d3.select(this).classed('hover', false)
        tooltip.style('display', 'none');
      });
};


function calcDotSize(val) {
  val = val * 500;
  //r = √(Area of circle / π)
  var radius = Math.sqrt(val/Math.PI);
  // NOTE(jnu): NaN values may indicate bugs. Here they are interpretted as
  // NAs in the data, so the correct action is to hide the dot.
  return radius || 0;
};


function zeroOrNumber(number) {
  if (isNaN(number)) {
    result = 0;
  } else {
    result = number;
  }
  return result;
};


function fillStateSelector(data, rate_type) {
  const div = d3.select('#' + rate_type + '_states_dropdown')
  const values = data.keys()
    .filter(k => {
        return data.get(k).values().some(v => {
            return v.values().some(l => {
                if (!Array.isArray(l)) {
                    return false;
                }
                return l.some(d => {
                    const value = d[rate_type];
                    return value !== "NA" && value !== "";
                });
            });
        });
    })
    .sort((a, b) => a < b ? -1 : 1);

  // add dropdown label with count of states
  div.select('button')
    .text('\n' + values.length + ' locations\n')
      .append('span')
        .classed("caret", true)
  
  const buttonList = div.select('.dropdown-menu')
  const li = buttonList.selectAll("li")
    .data(["All"].concat(values));

    // add option for each state
    li.enter().append('li');
    li.exit().remove();
    li
      .attr("title", d => d)
      .attr("class", "dropdown-item")
      .each(function(d) {
        const a = d3.select(this).selectAll("a").data([0]);
        a.enter().append('a');
        a.text(stateNames[d] || d);
      });

  // add click event to all options
  div.selectAll('li')
    .on('click', function(d) {
      const stateAbbrv = d3.select(this).attr('title')
      let stateName = d3.select(this).text()
      const selected_race = d3.select('#' + rate_type + '_race_btns')
        .selectAll('button')
        .filter('.active')
        .text()
        .toLowerCase();
      let statesCount;

      if (stateName == 'All') {
        // get count of li for label when all states are selected
        statesCount = d3.select(this.parentNode).selectAll('li')[0].length - 1
        stateName = '\n' +statesCount+ ' states\n'
      };

      if (rate_type == 'outcome') { 
          focusDots(stateAbbrv, selected_race, 'search_rate');
        } else { 
          focusDots(stateAbbrv, selected_race, rate_type);
      };
      // set the value and text of the button
      div.select('button')
        .attr('value', stateAbbrv)
        .text('\n' + stateName + '\n')
          .append('span')
            .classed("caret", true);
    });
};

function cleanNameForClass(s) {
    return s.replace(/\s+/g, "_").toLowerCase();
}


function focusDots(stateRaw, race, rate_type) {
  const div_id = "#" + rate_type + "_chart";
  const circles = d3.select(div_id).selectAll("circle")
  const state = cleanNameForClass(stateRaw); 

  // remove focus from all dots
  circles.classed('focused', false)

  if (state == 'all' && race == 'both') {
    // bring all dots back into normal focus
    circles.classed('unfocused', false)
  } else if (state == 'all') {
    // unfocus all dots
    circles.classed('unfocused', true)
    // re-focus dots with selected race
    circles.filter('.' + race)
      .classed('unfocused', false)
      .classed('focused', true)
      .moveToFront()
  } else if (race == 'both') {
    // unfocus all dots
    circles.classed('unfocused', true)
    // re-focus dots with selected state
    circles.filter('.' + state)
      .classed('unfocused', false)
      .classed('focused', true)
      .moveToFront()
  } else {
    // unfocus all dots
    circles.classed('unfocused', true)
    // re-focus dots with selected state and race
    circles.filter('.' + state).filter('.' + race)
      .classed('unfocused', false)
      .classed('focused', true)
      .moveToFront()
  }  
};


d3.selectAll(".race-btn").filter('.scatter')
  .on("click", function(d) {
    const race = d3.select(this).text().toLowerCase();
    const rate_type = d3.select(this).attr('id').replace('_' + race + '_btn', '');
    if ( d3.select(this).classed('inactive')) {
      // switch the other buttons to inactive
      d3.select(this.parentNode)
        .selectAll(".race-btn")
        .classed("inactive", true);
      // make all buttons inactive
      d3.select(this.parentNode).selectAll('button')
        .classed("active", false)
        .classed("inactive", true);
      // switch this button to active
      d3.select(this)
        .classed("inactive", false)
        .classed("active", true);
      
      const state = d3.select('#' + rate_type + '_states_dropdown')
        .select('button')
        .attr("value");

      if (rate_type == 'outcome') {
        focusDots(state, race, 'search_rate');
      } else {
        focusDots(state, race, rate_type);
      };
    };
  });

window.addEventListener("load", () => {
    initModeToggle();
    update();
});
