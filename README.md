# supercluster-super

This plugin relies on the aggregation layer implemented by superCluster



# Dependent package

ol6.4.3

## Instructions

1.  npm install selectcluster-super
2.  import SuperSelectCluster from "selectcluster-super"

## Main code demonstration

```ruby  
var superCluster = supercluster({radius: 40, maxZoom: 16})

superCluster.load(geojson.features)

// get GeoJSON clusters given a bounding box and zoom

var clusters = superCluster.getClusters([-180, -85, 180, 85], 2)

new  SuperSelectCluster({
	pointRadius,
	spiral,
	animate,
	layers,
	filter,
	superCluster,
});

```
