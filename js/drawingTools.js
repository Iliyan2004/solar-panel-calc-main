class DrawingTools {
    constructor(mapController) {
        this.mapController = mapController;
        this.drawMode = false;
        this.removeMode = false;
        this.subtractMode = false;
        this.alignByLineMode = false;
        this.alignmentLine = null;
        
        // Initialize draw control immediately
        this.initializeDrawControl();
    }

    initializeDrawControl() {
        try {
            this.draw = new MapboxDraw({
                displayControlsDefault: false,
                controls: {
                    polygon: true,
                    line_string: true,
                    trash: true
                },
                styles: [
                    // Polygon styles
                    {
                        id: 'gl-draw-polygon-fill',
                        type: 'fill',
                        filter: ['all', ['==', '$type', 'Polygon']],
                        paint: {
                            'fill-color': '#0080ff',
                            'fill-outline-color': '#0080ff',
                            'fill-opacity': 0.5
                        }
                    },
                    // Line styles
                    {
                        id: 'gl-draw-line',
                        type: 'line',
                        filter: ['all', ['==', '$type', 'LineString']],
                        paint: {
                            'line-color': '#ff0000',
                            'line-width': 3
                        }
                    }
                ]
            });

            if (this.mapController.map) {
                this.mapController.map.addControl(this.draw);
                this.drawControlActive = true;
                this.setupEventListeners();
                console.log("Draw control initialized successfully");
            } else {
                console.error("Map not available for draw control");
            }
        } catch (error) {
            console.error("Error initializing draw control:", error);
        }
    }

    setupEventListeners() {
        if (!this.draw) return;

        // Remove existing listeners
        this.mapController.map.off('draw.create');
        this.mapController.map.off('draw.modechange');

        // Add draw.create listener
        this.mapController.map.on('draw.create', (e) => {
            console.log('Feature created:', e.features[0]);
            const feature = e.features[0];

            if (feature.geometry.type === 'LineString' && this.alignByLineMode) {
                console.log('Alignment line created');
                this.alignmentLine = feature;
                alert("Alignment line set. Now calculate panels to align them along the line.");
            } else if (feature.geometry.type === 'Polygon') {
                this.handleDrawnPolygon(feature);
            }
        });

        // Add mode change listener
        this.mapController.map.on('draw.modechange', (e) => {
            console.log('Draw mode changed to:', e.mode);
        });
    }

    setDrawMode(enabled) {
        try {
            this.drawMode = enabled;
            this.removeMode = false;
            this.subtractMode = false;
            this.alignByLineMode = false;

            if (this.drawMode) {
                // Update UI
                $('#draw-polygon').addClass('bg-blue-700').removeClass('bg-blue-500');
                $('body').addClass('drawing-mode').removeClass('remove-mode subtract-mode align-by-line-mode');
                
                // Enable polygon drawing
                this.draw.changeMode('draw_polygon');
                this.showHelperMessage('Click to add points. Double-click to complete the polygon.');
            } else {
                $('#draw-polygon').addClass('bg-blue-500').removeClass('bg-blue-700');
                $('body').removeClass('drawing-mode');
                this.hideHelperMessage();
                this.draw.changeMode('simple_select');
            }
        } catch (error) {
            console.error("Error in setDrawMode:", error);
        }
    }

    setAlignByLineMode(enabled) {
        try {
            this.alignByLineMode = enabled;
            this.drawMode = false;
            this.removeMode = false;
            this.subtractMode = false;
            if (this.alignByLineMode) {
                $('#alignByLineBtn').addClass('bg-blue-700').removeClass('bg-blue-500');
                $('body').addClass('align-by-line-mode').removeClass('drawing-mode remove-mode subtract-mode');
                // CLEAR existing features to force mode change.
                if (this.draw) {
                    this.draw.deleteAll();
                    this.draw.changeMode('draw_line_string');
                    console.log("Switched to draw_line_string mode");
                }
                this.showHelperMessage('Draw a line to set panel alignment direction.');
            } else {
                $('#alignByLineBtn').addClass('bg-blue-500').removeClass('bg-blue-700');
                $('body').removeClass('align-by-line-mode');
                this.hideHelperMessage();
                if (this.draw) {
                    this.draw.changeMode('simple_select');
                }
            }
        } catch (error) {
            console.error("Error in setAlignByLineMode:", error);
        }
    }

    handleDrawnPolygon(polygon) {
        console.log("Handling drawn polygon:", polygon);
        
        // Check if turf is available
        if (typeof turf === 'undefined') {
            console.error("Turf.js is not defined! Cannot process polygon.");
            alert("Error: Turf.js library is missing. Please reload the page.");
            return;
        }
        
        // Ensure polygon has proper properties
        if (!polygon.properties) {
            polygon.properties = {};
        }
        
        // Calculate area
        polygon.properties.id = Date.now();
        try {
            polygon.properties.area = turf.area(polygon);
            console.log("Calculated area:", polygon.properties.area);
        } catch (e) {
            console.error("Error calculating area:", e);
            polygon.properties.area = 0;
        }

        if (this.subtractMode) {
            let subtracted = false;
            
            // Store the newly drawn polygon temporarily to avoid it being removed
            const innerPolygon = JSON.parse(JSON.stringify(polygon));
            
            // Try to subtract from existing polygons
            for (let i = 0; i < this.mapController.polygons.length; i++) {
                const existing = this.mapController.polygons[i];
                
                try {
                    // Try safer overlap detection instead of intersect
                    const isOverlapping = this.checkPolygonOverlap(existing, innerPolygon);
                    
                    console.log(`Checking polygon ${i}: Overlapping: ${isOverlapping}`);
                    
                    if (isOverlapping) {
                        // Store the subtracted holes information from the existing polygon
                        let existingHoles = [];
                        
                        // If the existing polygon already has holes (previous subtractions)
                        if (existing.geometry && existing.geometry.coordinates && existing.geometry.coordinates.length > 1) {
                            // Save all existing holes (all coordinates arrays except the first one which is the outer ring)
                            existingHoles = existing.geometry.coordinates.slice(1);
                            console.log(`Found ${existingHoles.length} existing holes in polygon`);
                        }
                        
                        // Use our enhanced subtraction method
                        const result = window.PolygonHelpers ? 
                            window.PolygonHelpers.subtract(existing, innerPolygon) : 
                            this.safeSubtract(existing, innerPolygon);
                        
                        if (result && result.geometry && result.geometry.coordinates) {
                            try {
                                // Verify the result is valid before updating
                                const isValid = window.PolygonHelpers ? 
                                    window.PolygonHelpers.isValidResult(result) : 
                                    turf.booleanValid(result);
                                    
                                if (isValid) {
                                    // If the result has a hole (which it should after subtraction)
                                    if (result.geometry.type === 'Polygon' && result.geometry.coordinates.length > 1) {
                                        // Keep just the outer ring and the newest hole (from this subtraction)
                                        const outerRing = result.geometry.coordinates[0];
                                        const newHole = result.geometry.coordinates[1]; // The newly created hole
                                        
                                        // Combine: outer ring + all previous holes + new hole
                                        result.geometry.coordinates = [outerRing, ...existingHoles];
                                        
                                        // Add the new hole if it's not already included
                                        if (newHole && newHole.length > 0) {
                                            // Check if this hole is already in our collection to avoid duplicates
                                            const isDuplicate = existingHoles.some(hole => 
                                                JSON.stringify(hole) === JSON.stringify(newHole));
                                                
                                            if (!isDuplicate) {
                                                result.geometry.coordinates.push(newHole);
                                            }
                                        }
                                    } else if (result.geometry.type === 'MultiPolygon') {
                                        // Handle MultiPolygon result (more complex case)
                                        console.log("MultiPolygon result detected from subtraction");
                                        // Convert MultiPolygon back to a single Polygon with holes
                                        const convertedResult = this.convertMultiPolygonToPolygonWithHoles(result, existingHoles);
                                        if (convertedResult) {
                                            this.mapController.polygons[i] = convertedResult;
                                            subtracted = true;
                                            console.log("Successfully converted MultiPolygon and preserved holes");
                                            break;
                                        }
                                    }
                                    
                                    this.mapController.polygons[i] = result;
                                    // Preserve original properties
                                    this.mapController.polygons[i].properties = {
                                        ...existing.properties,
                                        area: turf.area(result)
                                    };
                                    subtracted = true;
                                    console.log("Successfully subtracted inner polygon, preserved existing holes");
                                    break;
                                } else {
                                    console.error("Subtraction produced invalid polygon");
                                }
                            } catch (validationError) {
                                console.error("Error validating subtraction result:", validationError);
                            }
                        } else {
                            console.error("Subtraction returned null or invalid polygon");
                        }
                    }
                } catch (error) {
                    console.error("Error during subtraction check:", error);
                }
            }
            
            if (!subtracted) {
                this.showHelperMessage('Unable to subtract. Ensure the polygons overlap properly.', 'warning');
            }
            
            // Delete only the current drawn polygon without affecting the map
            try {
                if (this.draw && this.drawControlActive) {
                    // Delete only the current feature
                    const featureIds = this.draw.getAll().features.map(f => f.id);
                    for (const id of featureIds) {
                        this.draw.delete(id);
                    }
                }
            } catch (e) {
                console.warn("Error clearing drawn polygon:", e);
            }
            
            // Reset subtract mode only after handling the subtraction
            this.setSubtractMode(false);
            
            // Update map and results
            this.mapController.updateMap();
            this.mapController.updateResults();
            
            // Re-enable subtract mode if the user wants to continue subtracting
            setTimeout(() => {
                this.setSubtractMode(true);
            }, 100);
            
            return;
        } else if (this.drawMode) {
            console.log("Adding new polygon to collection");
            this.mapController.polygons.push(polygon);
            
            // Reset draw mode
            this.setDrawMode(false);
        }
        
        // Clear the drawn polygon - do this safely
        try {
            if (this.draw && this.drawControlActive) {
                this.draw.deleteAll();
            }
        } catch (e) {
            console.warn("Error clearing drawn polygon:", e);
        }
        
        // Update map and results
        this.mapController.updateMap();
        this.mapController.updateResults();
    }

    // Method to convert a MultiPolygon result back to a Polygon with holes
    convertMultiPolygonToPolygonWithHoles(multiPolygon, existingHoles = []) {
        try {
            if (!multiPolygon || !multiPolygon.geometry || multiPolygon.geometry.type !== 'MultiPolygon') {
                console.error("Invalid MultiPolygon input");
                return null;
            }
            
            // Find the largest polygon to use as the outer ring
            let largestPolygonIndex = 0;
            let largestArea = 0;
            
            for (let i = 0; i < multiPolygon.geometry.coordinates.length; i++) {
                const polygonCoords = multiPolygon.geometry.coordinates[i];
                const poly = turf.polygon(polygonCoords);
                const area = turf.area(poly);
                
                if (area > largestArea) {
                    largestArea = area;
                    largestPolygonIndex = i;
                }
            }
            
            // Use the largest polygon as the outer ring
            const outerRing = multiPolygon.geometry.coordinates[largestPolygonIndex][0];
            
            // Collect all other polygons as holes
            const newHoles = [];
            for (let i = 0; i < multiPolygon.geometry.coordinates.length; i++) {
                if (i !== largestPolygonIndex) {
                    // Add the outer ring of each other polygon as a hole
                    newHoles.push(multiPolygon.geometry.coordinates[i][0]);
                }
            }
            
            // Create a new Polygon feature with the outer ring and all holes
            const result = {
                type: 'Feature',
                properties: multiPolygon.properties || {},
                geometry: {
                    type: 'Polygon',
                    coordinates: [outerRing, ...existingHoles, ...newHoles]
                }
            };
            
            // Validate the result
            if (turf.booleanValid(result)) {
                return result;
            } else {
                console.error("Created invalid polygon from MultiPolygon");
                return null;
            }
        } catch (error) {
            console.error("Error converting MultiPolygon to Polygon with holes:", error);
            return null;
        }
    }

    // Enhanced safeSubtract function to better handle multiple subtractions
    safeSubtract(outerPolygon, innerPolygon) {
        try {
            // Check for valid polygons
            if (!outerPolygon || !innerPolygon) {
                console.error("Invalid polygons for subtraction");
                return null;
            }
            
            // Convert to GeoJSON if needed
            const outerGeoJSON = outerPolygon.type === 'Feature' ? outerPolygon : turf.feature(outerPolygon);
            const innerGeoJSON = innerPolygon.type === 'Feature' ? innerPolygon : turf.feature(innerPolygon);
            
            // Ensure valid polygon geometries
            if (!turf.booleanValid(outerGeoJSON) || !turf.booleanValid(innerGeoJSON)) {
                console.error("Input polygons are invalid");
                return outerPolygon;
            }
            
            // Store existing holes from the outer polygon
            let existingHoles = [];
            if (outerGeoJSON.geometry.coordinates.length > 1) {
                existingHoles = outerGeoJSON.geometry.coordinates.slice(1);
            }
            
            // Method 1: Direct difference with hole preservation
            try {
                const outerRing = outerGeoJSON.geometry.coordinates[0];
                const simplifiedOuter = turf.polygon([outerRing]);
                const result = turf.difference(simplifiedOuter, innerGeoJSON);
                
                if (result && turf.booleanValid(result)) {
                    // If the result is a Polygon
                    if (result.geometry.type === 'Polygon') {
                        // Add back all existing holes
                        if (existingHoles.length > 0) {
                            const resultRing = result.geometry.coordinates[0];
                            let newHoles = [];
                            
                            // Add any new holes from this subtraction
                            if (result.geometry.coordinates.length > 1) {
                                newHoles = result.geometry.coordinates.slice(1);
                            }
                            
                            result.geometry.coordinates = [resultRing, ...existingHoles, ...newHoles];
                        }
                        
                        console.log("Method 1 (direct difference with hole preservation) succeeded");
                        return result;
                    }
                }
            } catch (e) {
                console.warn("Method 1 failed:", e);
            }
            
            // Method 2: Try with buffered polygons
            try {
                const bufferedOuter = turf.buffer(outerGeoJSON, 0.0000001);
                const bufferedInner = turf.buffer(innerGeoJSON, 0.0000001);
                
                // Only use the outer ring for the subtraction
                const outerRing = bufferedOuter.geometry.coordinates[0];
                const simplifiedOuter = turf.polygon([outerRing]);
                
                const result = turf.difference(simplifiedOuter, bufferedInner);
                if (result && turf.booleanValid(result)) {
                    // If the result is a Polygon
                    if (result.geometry.type === 'Polygon') {
                        // Add back all existing holes
                        if (existingHoles.length > 0) {
                            const resultRing = result.geometry.coordinates[0];
                            let newHoles = [];
                            
                            // Add any new holes from this subtraction
                            if (result.geometry.coordinates.length > 1) {
                                newHoles = result.geometry.coordinates.slice(1);
                            }
                            
                            result.geometry.coordinates = [resultRing, ...existingHoles, ...newHoles];
                        }
                        
                        console.log("Method 2 (buffered difference with hole preservation) succeeded");
                        return result;
                    }
                }
            } catch (e) {
                console.warn("Method 2 failed:", e);
            }
            
            // Method 3: Use polygon clipping
            try {
                // Ensure we're working with MultiPolygon for consistency
                const outerCoords = outerGeoJSON.geometry.coordinates;
                const innerCoords = innerGeoJSON.geometry.coordinates;
                
                // Create a new feature with clean coordinates
                const result = {
                    type: 'Feature',
                    properties: outerGeoJSON.properties || {},
                    geometry: {
                        type: 'Polygon',
                        coordinates: [outerCoords[0], ...existingHoles]
                    }
                };
                
                // Add the inner polygon as a hole in the outer polygon
                if (result.geometry.coordinates[0] && innerCoords[0]) {
                    // Adding the inner ring as a hole in the outer ring
                    result.geometry.coordinates.push(innerCoords[0]);
                }
                
                if (turf.booleanValid(result)) {
                    console.log("Method 3 (manual hole creation with existing holes preserved) succeeded");
                    return result;
                }
            } catch (e) {
                console.warn("Method 3 failed:", e);
            }
            
            // If all methods fail, return the original
            console.error("All subtraction methods failed");
            return outerPolygon;
        } catch (error) {
            console.error("Error in safeSubtract:", error);
            return outerPolygon;  // Return the original rather than null to avoid breaking the UI
        }
    }

    // Helper method to check if two polygons overlap without using intersect
    checkPolygonOverlap(poly1, poly2) {
        try {
            // First try booleanOverlap which is more forgiving
            return turf.booleanOverlap(poly1, poly2) || turf.booleanContains(poly1, poly2) || turf.booleanContains(poly2, poly1);
        } catch (e) {
            console.warn("Primary overlap check failed:", e);
            
            try {
                // Fallback to manual checking with buffered polygons
                const buffered1 = turf.buffer(poly1, 0.000001);
                const buffered2 = turf.buffer(poly2, 0.000001);
                
                // Try a more direct approach - check if any point of poly2 is in poly1
                const coords = poly2.geometry.coordinates[0];
                for (let i = 0; i < coords.length; i++) {
                    const pt = turf.point(coords[i]);
                    if (turf.booleanPointInPolygon(pt, buffered1)) {
                        return true;
                    }
                }
                
                // And vice versa
                const coords2 = poly1.geometry.coordinates[0];
                for (let i = 0; i < coords2.length; i++) {
                    const pt = turf.point(coords2[i]);
                    if (turf.booleanPointInPolygon(pt, buffered2)) {
                        return true;
                    }
                }
                
                return false;
            } catch (err) {
                console.error("Fallback overlap check failed:", err);
                return false;
            }
        }
    }

    showHelperMessage(message, type = 'info') {
        // Remove any existing helper message
        this.hideHelperMessage();

        // Create message with appropriate styling
        let className = 'fixed top-4 left-1/2 transform -translate-x-1/2 px-4 py-2 rounded-lg text-sm z-50 ';
        
        if (type === 'warning') {
            className += 'bg-yellow-600 text-white';
        } else {
            className += 'bg-black bg-opacity-70 text-white';
        }

        $('body').append(`
            <div id="helper-message" class="${className}">
                ${message}
            </div>
        `);

        // Auto-hide after 5 seconds
        setTimeout(() => {
            this.hideHelperMessage();
        }, 5000);
    }

    hideHelperMessage() {
        $('#helper-message').remove();
    }

    clearAll() {
        this.mapController.polygons = [];
        
        // Safely clear drawing features
        try {
            if (this.draw && this.drawControlActive) {
                this.draw.deleteAll();
            }
        } catch (e) {
            console.warn("Error clearing drawn features:", e);
        }
        
        this.mapController.updateMap();
        this.mapController.updateResults();
        this.mapController.solarArrays = [];
        this.mapController.updateArraysOnMap();
        this.alignmentLine = null;
    }

    removePolygonAtPoint(lngLat) {
        const point = turf.point([lngLat.lng, lngLat.lat]);

        for (let i = 0; i < this.mapController.polygons.length; i++) {
            const poly = this.mapController.polygons[i];
            if (turf.booleanPointInPolygon(point, poly)) {
                this.mapController.polygons.splice(i, 1);
                this.mapController.updateMap();
                this.mapController.updateResults();
                
                // After removal, update solar arrays
                this.mapController.solarArrays = [];
                this.mapController.updateArraysOnMap();
                break;
            }
        }
    }
}