module PruneCluster {

	// Use a quicksort algorithm instead of the insertion sort
	// algorithm when the number of changes in the cluster
	// exceed this ratio 
	var ratioForNativeSort = 0.2;

	export interface Position {
		lat: number;
		lng: number;
	}

	export class Point {
		x: number;
		y: number;
	}

	export interface Bounds {
		minLat: number;
		maxLat: number;
		minLng: number;
		maxLng: number;
	}


	export class ClusterObject {
		public position: Position;
		public data: any;
	}

	export class Marker extends ClusterObject {

		public category: string;
		public weight:number;

		constructor(lat: number, lng: number, data: {} = {}) {
			super();
			this.data = data;
			this.position = { lat: lat, lng: lng };
			this.weight = 1;
		}

		public Move(lat: number, lng: number) {
			this.position.lat = lat;
			this.position.lng = lng;
		}

	}

	export class Cluster extends ClusterObject {
		public bounds: Bounds;
		public population: number;

		public averagePosition: Position;
		public stats: { [category: string]: number };

		public totalWeight: number;

		public lastMarker: Marker;

		constructor(marker: Marker) {
			super();

			this.lastMarker = marker;

			this.stats = {};
			this.data = {};
			this.population = 1;

			if (marker.category) {
				this.stats[marker.category] = 1;
			}

			this.totalWeight = marker.weight;

			this.position = {
				lat: marker.position.lat,
				lng: marker.position.lng
			};

			this.averagePosition = {
				lat: marker.position.lat,
				lng: marker.position.lng
			};

		}

		public AddMarker(marker: Marker) {

			this.lastMarker = marker;

			// Compute the weighted arithmetic mean
			var weight = marker.weight,
				currentTotalWeight = this.totalWeight,
				newWeight = weight + currentTotalWeight;

			this.averagePosition.lat =
			(this.averagePosition.lat * currentTotalWeight +
				marker.position.lat * weight) / newWeight;

			this.averagePosition.lng =
			(this.averagePosition.lng * currentTotalWeight +
				marker.position.lng * weight) / newWeight;

			++this.population;
			this.totalWeight = newWeight;

			// Update the statistics if needed
			if (marker.category) {
				if (this.stats.hasOwnProperty(marker.category)) {
					++this.stats[marker.category];
				} else {
					this.stats[marker.category] = 1;
				}
			}
		}

		public Reset() {
			this.lastMarker = undefined;
			this.population = 0;
			this.totalWeight = 0;
		}

		// Compute the bounds
		// Settle the cluster to the projected grid
		public ComputeBounds(cluster: PruneCluster) {

			var proj = cluster.Project(this.position.lat, this.position.lng);

			var size = cluster.Size;

			// Compute the position of the cluster
			var nbX = Math.floor(proj.x / size),
				nbY = Math.floor(proj.y / size),
				startX = nbX * size,
				startY = nbY * size;

			// Project it to lat/lng values
			var a = cluster.UnProject(startX, startY),
				b = cluster.UnProject(startX + size, startY + size);

			this.bounds = {
				minLat: b.lat,
				maxLat: a.lat,
				minLng: a.lng,
				maxLng: b.lng
			};
		}
	}

	function checkPositionInsideBounds(a: Position, b: Bounds): boolean {
		return (a.lat >= b.minLat && a.lat <= b.maxLat) &&
			a.lng >= b.minLng && a.lng <= b.maxLng;
	}

	function insertionSort(list: ClusterObject[]) {
		for (var i: number = 1, j: number, tmp: ClusterObject,
			tmpLng: number, length = list.length; i < length; ++i) {
			tmp = list[i];
			tmpLng = tmp.position.lng;
			for (j = i - 1; j >= 0 && list[j].position.lng > tmpLng; --j) {
				list[j + 1] = list[j];
			}
			list[j + 1] = tmp;
		}
	}

	export class PruneCluster {
		private _markers: Marker[] = [];

		// Represent the number of marker added or deleted since the last sort
		private _nbChanges: number = 0;

		private _clusters: Cluster[] = [];

		// Cluster size in (in pixels)
		public Size: number = 166;

		// View padding (extended size of the view)
		public ViewPadding: number = 0.13;

		// These methods should be defined by the user
		public Project: (lat:number, lng:number) => Point;
		public UnProject: (x:number, y:number) => Position;

		public RegisterMarker(marker: Marker) {
			if ((<any>marker)._removeFlag) {
				delete (<any>marker)._removeFlag;
			}
			this._markers.push(marker);
			this._nbChanges += 1;
		}


		private _sortMarkers() {
			var markers = this._markers,
				length = markers.length;

			if (this._nbChanges && (!length || this._nbChanges / length > ratioForNativeSort)) {
				// Native sort
				this._markers.sort((a: Marker, b: Marker) => a.position.lng - b.position.lng);
			} else {
				// Insertion sort (faster for sorted or almost sorted arrays)
				insertionSort(markers);
			}

			// Now the list is sorted, we can reset the counter
			this._nbChanges = 0;
		}

		private _sortClusters() {
			// Insertion sort because the list is often almost sorted
			// and we want to have a stable list of clusters
			insertionSort(this._clusters);
		}

		private _indexLowerBoundLng(lng: number): number {
			// Inspired by std::lower_bound

			// It's a binary search algorithm
			var markers = this._markers,
				it,
				step,
				first = 0,
				count = markers.length;
			
			while (count > 0) {
				step = Math.floor(count / 2);
				it = first + step;
				if (markers[it].position.lng < lng) {
					first = ++it;
					count -= step + 1;
				} else {
					count = step;
				}
			}

			return first;
		}

		private _resetClusterViews() {
			// Reset all the clusters
			for (var i = 0, l = this._clusters.length; i < l; ++i) {
				var cluster = this._clusters[i];
				cluster.Reset();

				// The projection changes in accordance with the view's zoom level
				// (at least with Leaflet.js)
				cluster.ComputeBounds(this);
			}
		}

		public ProcessView(bounds: Bounds): Cluster[]{

			// Compute the extended bounds of the view
			var heightBuffer = Math.abs(bounds.maxLat - bounds.minLat) * this.ViewPadding,
				widthBuffer = Math.abs(bounds.maxLng - bounds.minLng) * this.ViewPadding;

			var extendedBounds: Bounds = {
				minLat: bounds.minLat - heightBuffer - heightBuffer,
				maxLat: bounds.maxLat + heightBuffer + heightBuffer,
				minLng: bounds.minLng - widthBuffer - widthBuffer,
				maxLng: bounds.maxLng + widthBuffer + widthBuffer
			};

			// We keep the list of all markers sorted
			// It's faster to keep the list sorted so we can use
			// a insertion sort algorithm which is faster for sorted lists
			this._sortMarkers();

			// Reset the cluster for the new view
			this._resetClusterViews();

			// Binary search for the first interesting marker
			var firstIndex = this._indexLowerBoundLng(extendedBounds.minLng);
			//console.log("Start index: ", firstIndex);

			// Just some shortcuts
			var markers = this._markers,
				clusters = this._clusters;

//			var cpt = 0;

			var workingClusterList = clusters.slice(0);

			// For every markers in the list
			for (var i = firstIndex, l = markers.length; i < l; ++i) {

				var marker = markers[i],
					markerPosition = marker.position;

				// If the marker longitute is higher than the view longitude,
				// we can stop to iterate
				if (markerPosition.lng > extendedBounds.maxLng) {
					//console.log("End index: ", i);
					break;
				}


				// If the marker is inside the view
				if (markerPosition.lat > extendedBounds.minLat &&
					markerPosition.lat < extendedBounds.maxLat) {

					var clusterFound = false, cluster: Cluster;

					// For every active cluster
					for (var j = 0, ll = workingClusterList.length; j < ll; ++j) {
						cluster = workingClusterList[j];

						// If the cluster is far away the current marker
						// we can remove it from the list of active clusters
						// because we will never reach it again
						if (cluster.bounds.maxLng < marker.position.lng) {
							workingClusterList.splice(j, 1);
							--j;
							--ll;
							continue;
						}

						if (checkPositionInsideBounds(markerPosition, cluster.bounds)) {
							cluster.AddMarker(marker);
							// We found a marker, we don't need to go further
							clusterFound = true;
							break;
						}
					}


					// If the marker doesn't fit in any cluster,
					// we must create a brand new cluster.
					if (!clusterFound) {
						cluster = new Cluster(marker);
						cluster.ComputeBounds(this);
						clusters.push(cluster);
						workingClusterList.push(cluster);
					}
					
//					++cpt;
				}
			}

			//console.log("Cpt: ", cpt);

			// Time to remove empty clusters
			var newClustersList: Cluster[] = [];
			for (i = 0, l = clusters.length; i < l; ++i) {
				cluster = clusters[i];
				if (cluster.population > 0) {
					newClustersList.push(cluster);
				}
			}

			//console.log("Avant: ", clusters.length, "Apr�s: ", newClustersList.length);
			this._clusters = newClustersList;

			// We keep the list of markers sorted, it's faster
			this._sortClusters();

			return this._clusters;
		}

		public RemoveMarkers(markers: Marker[]) {

			// Mark the markers to be deleted
			for (var i = 0, l = markers.length; i < l; ++i) {
				(<any>markers[i])._removeFlag = true;
			}

			// Create a new list without the marked markers
			var newMarkersList = [];
			for (i = 0, l = this._markers.length; i < l; ++i) {
				if (!(<any>this._markers[i])._removeFlag) {
					newMarkersList.push(this._markers[i]);
				}
			}

			this._markers = newMarkersList;
		}

		// This method is a bit slow ( O(n)) because it's not worth to make
		// system which will slow down all the clusters just to have
		// this one fast
		public FindMarkersBoundsInArea(area: Bounds): Bounds {
			var aMinLat = area.minLat,
				aMaxLat = area.maxLat,
				aMinLng = area.minLng,
				amaxLng = area.maxLng,
				
				rMinLat = Number.MAX_VALUE,
				rMaxLat = Number.MIN_VALUE,
				rMinLng = Number.MAX_VALUE,
				rMaxLng = Number.MIN_VALUE,
				
				markers = this._markers,
				nbMarkersInArea = 0;

			for (var i = 0, l = markers.length; i < l; ++i) {
				var pos = markers[i].position;
				if (pos.lat >= aMinLat && pos.lat <= aMaxLat &&
					pos.lng >= aMinLng && pos.lng <= amaxLng) {

					++nbMarkersInArea;

					if (pos.lat < rMinLat) rMinLat = pos.lat;
					if (pos.lat > rMaxLat) rMaxLat = pos.lat;
					if (pos.lng < rMinLng) rMinLng = pos.lng;
					if (pos.lng > rMaxLng) rMaxLng = pos.lng;
				}
			}

			if (nbMarkersInArea) {
				return {
					minLat: rMinLat,
					maxLat: rMaxLat,
					minLng: rMinLng,
					maxLng: rMaxLng
				};
			}

			return null;
		}

	}
}