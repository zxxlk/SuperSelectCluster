import inherits from "../src/util/ext.js";
import Map from "ol/Map";
import Collection from "ol/Collection";
import { Vector as VectorSource } from "ol/source";
import Select from "ol/interaction/Select";
import Feature from "ol/Feature";
import LineString from "ol/geom/LineString";
import { unByKey } from "ol/Observable";
import { easeOut } from "ol/easing";
import { Point } from "ol/geom";
import { Circle, Style } from "ol/style";
import { extend, createEmpty } from "ol/extent";
import VectorLayer from "ol/layer/Vector";
import { GeoJSON } from "ol/format";
import { getVectorContext } from "ol/render";
import $ from 'jquery';
/**
 * @classdesc
 * Interaction for selecting vector features in a cluster.
 * It can be used as an ol.interaction.Select.
 * When clicking on a cluster, it springs apart to reveal the features in the cluster.
 * Revealed features are selectable and you can pick the one you meant.
 * Revealed features are themselves a cluster with an attribute features that contain the original feature.
 *
 * @constructor
 * @extends {ol.interaction.Select}
 * @param {olx.interaction.SelectOptions=} options SelectOptions.
 *  @param {ol.style} options.featureStyle used to style the revealed features as options.style is used by the Select interaction.
 * 	@param {boolean} options.selectCluster false if you don't want to get cluster selected
 * 	@param {Number} options.pointRadius to calculate distance between the features
 * 	@param {bool} options.spiral means you want the feature to be placed on a spiral (or a circle)
 * 	@param {Number} options.circleMaxObjects number of object that can be place on a circle
 * 	@param {Number} options.maxObjects number of object that can be drawn, other are hidden
 * 	@param {bool} options.animate if the cluster will animate when features spread out, default is false
 * 	@param {Number} options.animationDuration animation duration in ms, default is 500ms
 *  @param {superCluster} options.superCluster superCluster load features
 * @fires ol.interaction.SelectEvent
 * @api stable
 */
const CHILDRENNUM = 30; //max childrensNum
let childrenPointFeaturesArr = [];
let SuperSelectCluster = function(options) {
  options = options || {};
  let fn;
  this.pointRadius = options.pointRadius || 12;
  this.circleMaxObjects = options.circleMaxObjects || 10;
  this.maxObjects = options.maxObjects || 60;
  this.spiral = options.spiral !== false;
  this.animate = options.animate;
  this.animationDuration = options.animationDuration || 500;
  this.selectCluster_ = options.selectCluster !== false;
  this.superCluster_ = options.superCluster;

  // Create a new overlay layer for
  let overlay = (this.overlayLayer_ = new VectorLayer({
    source: new VectorSource({
      features: new Collection(),
      wrapX: options.wrapX,
      useSpatialIndex: true,
    }),
    name: "Cluster overlay",
    updateWhileAnimating: true,
    updateWhileInteracting: true,
    displayInLayerSwitcher: false,
    style: options.featureStyle,
  }));

  // Add the overlay to selection
  if (options.layers) {
    if (typeof options.layers == "function") {
      fn = options.layers;
      options.layers = function(layer) {
        return layer === overlay || fn(layer);
      };
    } else if (options.layers.push) {
      options.layers.push(this.overlayLayer_);
    }
  }

  // Don't select links
  if (options.filter) {
    fn = options.filter;
    options.filter = function(f, l) {
      //if (l===overlay && f.get("selectclusterlink")) return false;
      if (!l && f.get("selectclusterlink")) return false;
      else return fn(f, l);
    };
  } else
    options.filter = function(f, l) {
      //if (l===overlay && f.get("selectclusterlink")) return false;
      if (!l && f.get("selectclusterlink")) return false;
      else return true;
    };
  this.filter_ = options.filter;

  Select.call(this, options);
  this.on("select", this.selectCluster.bind(this));
};

inherits(SuperSelectCluster, Select);

/**
 * Remove the interaction from its current map, if any,  and attach it to a new
 * map, if any. Pass `null` to just remove the interaction from the current map.
 * @param {ol.Map} map Map.
 * @api stable
 */
SuperSelectCluster.prototype.setMap = function(map) {
  if (this.getMap()) {
    this.getMap().removeLayer(this.overlayLayer_);
  }
  if (this._listener) unByKey(this._listener);
  this._listener = null;

  Select.prototype.setMap.call(this, map);
  this.overlayLayer_.setMap(map);
  // map.addLayer(this.overlayLayer_);

  if (map && map.getView()) {
    this._listener = map
      .getView()
      .on("change:resolution", this.clear.bind(this));
  }
};

/**
 * Clear the selection, close the cluster and remove revealed features
 * @api stable
 */
SuperSelectCluster.prototype.clear = function() {
  this.getFeatures().clear();
  this.overlayLayer_.getSource().clear();
};

/**
 * Get the layer for the revealed features
 * @api stable
 */
SuperSelectCluster.prototype.getLayer = function() {
  return this.overlayLayer_;
};

/**
 * Select a cluster
 * @param {ol.SelectEvent | ol.Feature} a cluster feature ie. a feature with a 'features' attribute.
 * @api stable selected feature event
 */
SuperSelectCluster.prototype.selectCluster = function(e) {
  // It's a feature => convert to SelectEvent
  if (e instanceof Feature) {
    e = { selected: [e] };
  }
  // Nothing selected
  if (!e.selected.length) {
    this.clear();
    return;
  }
  // Get selection
  let feature = e.selected[0];
  if (feature.get("selectclusterfeature")) return;
  // Clic out of the cluster => close it
  let source = this.overlayLayer_.getSource();
  source.clear();
  // selected Feature => child features
  const childrenFeaturesArr = getChildrenFeatures(feature, this.superCluster_);
  const cluster = featureCollection(childrenFeaturesArr);
  if (!cluster || cluster.length == 1) return;
  if (!this.selectCluster_) this.getFeatures().clear();
  let center;
  if (feature.getProperties().cluster) {
    center = feature.get("geometry").getCoordinates();
  } else {
    center = feature.getGeometry().getCoordinates();
  }
  let pix = this.getMap()
    .getView()
    .getResolution();
  let r, a, i, max;
  let p, cf, lk;
  let features = [];
  // Draw on a circle
  if (!this.spiral || cluster.length <= this.circleMaxObjects) {
    max = Math.min(cluster.length, this.circleMaxObjects);
    r = pix * this.pointRadius * (0.5 + max / 4);
    for (i = 0; i < max; i++) {
      a = (2 * Math.PI * i) / max;
      if (max == 2 || max == 4) a += Math.PI / 4;
      p = [center[0] + r * Math.sin(a), center[1] + r * Math.cos(a)];
      cf = new Feature({
        selectclusterfeature: true,
        features: [cluster[i]],
        geometry: new Point(p),
      });
      cf.setStyle(cluster[i].getStyle());
      features.push(cf);
      lk = new Feature({
        selectclusterlink: true,
        geometry: new LineString([center, p]),
      });
      features.push(lk);
    }
  } else {
    // Start angle
    a = 0;
    var d = 2 * this.pointRadius;
    max = Math.min(this.maxObjects, cluster.length);
    // Feature on a spiral
    for (i = 0; i < max; i++) {
      // New radius => increase d in one turn
      r = d / 2 + (d * a) / (2 * Math.PI);
      // Angle
      a = a + (d + 0.1) / r;
      var dx = pix * r * Math.sin(a);
      var dy = pix * r * Math.cos(a);
      p = [center[0] + dx, center[1] + dy];
      cf = new Feature({
        selectclusterfeature: true,
        features: [cluster[i]],
        geometry: new Point(p),
      });
      cf.setStyle(cluster[i].getStyle());
      features.push(cf);
      lk = new Feature({
        selectclusterlink: true,
        geometry: new LineString([center, p]),
      });
      features.push(lk);
    }
  }
  source.clear();
  if (this.animate) {
    this.animateCluster_(center, features);
  } else {
    source.addFeatures(features);
  }
};
/**
 *
 * @param {feature-> childrenFeatures} feature
 *
 */
function getChildrenFeatures(feature, superCluster) {
  childrenPointFeaturesArr = [];
  const featureId = feature.getProperties().cluster_id;
  const childrenFeatureArr = superCluster.getChildren(featureId);
  return getChildrens(childrenFeatureArr, superCluster);
}
/**
 *  all children Features
 */
function getChildrens(featureObjArr, superCluster) {
  featureObjArr.forEach((element) => {
    if (element.properties.cluster) {
      const children_id = element.properties.cluster_id;
      const childrens = superCluster.getChildren(children_id);
      getChildrens(childrens, superCluster);
    } else {
      if (childrenPointFeaturesArr.length < CHILDRENNUM)
        childrenPointFeaturesArr.push(element);
    }
  });
  return childrenPointFeaturesArr;
}

/**
 *
 * @param {featureCollection} featuresObj
 */
function featureCollection(featuresObj) {
  const featureCollectionObject = {
    type: "FeatureCollection",
    features: featuresObj,
  };
  return new GeoJSON({
    dataProjection: "EPSG:4326",
    featureProjection: "EPSG: 3857",
  }).readFeatures(featureCollectionObject);
}
/**
 * Animate the cluster and spread out the features
 * @param {ol.Coordinates} the center of the cluster
 */
SuperSelectCluster.prototype.animateCluster_ = function(center, features) {
  // Stop animation (if one is running)
  if (this.listenerKey_) {
    unByKey(this.listenerKey_);
  }
  if (!features.length) return;
  const style = this.overlayLayer_.getStyle();
  const stylefn =
    typeof style == "function"
      ? style
      : style.length
      ? function() {
          return style;
        }
      : function() {
          return [style];
        };
  const duration = this.animationDuration || 500;
  const start = new Date().getTime();
  function animate(event) {
    const vectorContext = event.vectorContext || getVectorContext(event);
    // Retina device
    const ratio = event.frameState.pixelRatio;
    const res = this.getMap()
      .getView()
      .getResolution();
    const e = easeOut((event.frameState.time - start) / duration);
    for (let i = 0, feature; (feature = features[i]); i++)
      if (feature.getProperties().selectclusterfeature) {
        const pt = feature.getGeometry().getCoordinates();
        pt[0] = center[0] + e * (pt[0] - center[0]);
        pt[1] = center[1] + e * (pt[1] - center[1]);
        const geo = new Point(pt);
        // Image style
        const st = stylefn(feature, res);
        //实现动画展开元素--
        let sty = [];
        if (!st.length) {
          sty[0] = st;
        } else {
          sty = st;
        }
        for (let s = 0; s < sty.length; s++) {
          let sc;
          // OL < v4.3 : setImageStyle doesn't check retina
          let imgs = Map.prototype.getFeaturesAtPixel
            ? false
            : styst[s].getImage();
          if (imgs) {
            sc = imgs.getScale();
            imgs.setScale(ratio);
          }
          // OL3 > v3.14
          if (vectorContext.setStyle) {
            vectorContext.setStyle(sty[s]);
            vectorContext.drawGeometry(geo);
          }
          // older version
          else {
            vectorContext.setImageStyle(imgs);
            vectorContext.drawPointGeometry(geo);
          }
          if (imgs) imgs.setScale(sc);
        }
      }
    // Stop animation and restore cluster visibility
    if (e > 1.0) {
      unByKey(this.listenerKey_);
      this.overlayLayer_.getSource().addFeatures(features);
      this.overlayLayer_.changed();
      return;
    }

    // tell OL3 to continue postcompose animation
    event.frameState.animate = true;
  }
  // Start a new postcompose animation
  this.listenerKey_ = this.overlayLayer_.on(
    ["postcompose", "postrender"],
    animate.bind(this)
  );
  // Start animation with a ghost feature
  let feature = new Feature(
    new Point(
      this.getMap()
        .getView()
        .getCenter()
    )
  );
  feature.setStyle(new Style({ image: new Circle({}) }));
  this.overlayLayer_.getSource().addFeature(feature);
};

/** Helper function to get the extent of a cluster
 * @param {ol.feature} feature
 * @return {ol.extent|null} the extent or null if extent is empty (no cluster or superimposed points)
 */
SuperSelectCluster.prototype.getClusterExtent = function(feature) {
  if (!feature.getProperties().cluster) return null;
  var extent = createEmpty();
  const childrenFeaturesArr = getChildrenFeatures(feature, this.superCluster_);
  const featuresObj = featureCollection(childrenFeaturesArr);
  featuresObj.forEach(function(f) {
    extent = extend(extent, f.getGeometry().getExtent());
  });
  if (extent[0] === extent[2] && extent[1] === extent[3]) return null;
  return extent;
};

export default SuperSelectCluster;
