import { CommonModule } from '@angular/common';
import type { OnDestroy, OnInit } from '@angular/core';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonContent } from '@ionic/angular';
import * as L from 'leaflet';

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonContent],
})
export class HomePage implements OnInit, OnDestroy {
  serverUrl: string = 'http://192.168.1.6:8000';
  ngOnInit(): void {
    const savedIp = localStorage.getItem('custom_server_url');
    if (savedIp) {
      this.serverUrl = savedIp;
    }
  }
  updateServerUrl(newUrl: string): void {
    this.serverUrl = newUrl.trim();
    localStorage.setItem('custom_server_url', this.serverUrl);
  }
  loggedInUser: any = null;

  authUsername: string = '';
  authPassword: string = '';
  authFullName: string = '';
  authMessage: string = '';

  stops: any[] = [];
  buses: any[] = [];
  selectedStopId: number = 1;
  destinationStopId: number = 6;

  fbBusId: string = 'BUS-101';
  fbCategory: string = 'Driver/Conductor Courtesy';
  fbMessage: string = '';
  fbStatus: string = '';

  private map?: L.Map;
  private busMarkers: { [key: string]: L.Marker } = {};
  private busVectors: {
    [key: string]: { lat: number; lng: number; dLat: number; dLng: number };
  } = {};
  private routePolyline?: L.Polyline;
  private pollTimer?: any;

  ngOnDestroy(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
    }
  }

  async login(): Promise<void> {
    this.authMessage = '';
    const uname = this.authUsername.trim();
    const pword = this.authPassword.trim();
    this.serverUrl = this.serverUrl.trim().replace(/\/+$/, '');
    if (!this.serverUrl.startsWith('http://') && !this.serverUrl.startsWith('https://')) {
      this.serverUrl = 'http://' + this.serverUrl;
    }
    if (!uname || !pword) {
      this.authMessage = 'Please enter your username and password.';
      return;
    }
    try {
      const res = await fetch(`${this.serverUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: uname,
          password: pword,
          role: 'Passenger',
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        this.authMessage = data.detail || 'Invalid username or password.';
        return;
      }
      this.loggedInUser = data;
      setTimeout(() => {
        this.initMap();
        this.syncAll();
        this.pollTimer = setInterval(() => this.syncBuses(), 2500);
      }, 250);
    } catch {
      this.authMessage = 'Cannot connect to server. Check IP and port.';
    }
  }

  async signup(): Promise<void> {
    this.authMessage = '';
    const uname = this.authUsername.trim();
    const pword = this.authPassword.trim();
    const fname = this.authFullName.trim() || uname;
    this.serverUrl = this.serverUrl.trim().replace(/\/+$/, '');
    if (!this.serverUrl.startsWith('http://') && !this.serverUrl.startsWith('https://')) {
      this.serverUrl = 'http://' + this.serverUrl;
    }
    if (!uname || !pword) {
      this.authMessage = 'Please enter a username and password to sign up.';
      return;
    }
    try {
      const res = await fetch(`${this.serverUrl}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: uname,
          password: pword,
          full_name: fname,
          role: 'Passenger',
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        this.authMessage = data.detail || 'Sign-up failed.';
        return;
      }
      this.loggedInUser = data;
      setTimeout(() => {
        this.initMap();
        this.syncAll();
        this.pollTimer = setInterval(() => this.syncBuses(), 2500);
      }, 250);
    } catch {
      this.authMessage = 'Cannot connect to server. Check IP and port.';
    }
  }

  logout(): void {
    this.loggedInUser = null;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
    }
    if (this.map) {
      this.map.remove();
      this.map = undefined;
      this.busMarkers = {};
    }
  }

  initMap(): void {
    if (this.map) return;
    
    // Set logical zoom bounds so it cannot zoom out into multiple worlds
    this.map = L.map('passengerMap', {
      minZoom: 10,  // Prevents zooming out past regional view
      maxZoom: 18,  // Prevents over-zooming
    }).setView([15.5565427, 121.0925970], 11);

    // noWrap: true stops the map from repeating horizontally
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      noWrap: true,
    }).addTo(this.map);

    setTimeout(() => this.map?.invalidateSize(), 200);
  }

  async syncAll(): Promise<void> {
    await this.loadStops();
    await this.syncBuses();
  }

  onStopChange(): void {
    const chosen = this.stops.find((s) => s.stop_id === Number(this.selectedStopId));
    if (chosen) {
      this.focusStop(chosen);
    }
  }

  async loadStops(): Promise<void> {
    try {
      const res = await fetch(`${this.serverUrl}/api/stops`);
      this.stops = await res.json();
      if (!this.map) return;

      const coords: L.LatLngExpression[] = [];
      this.stops.forEach((s) => {
        coords.push([s.lat, s.lng]);
        L.circleMarker([s.lat, s.lng], {
          radius: 6,
          fillColor: '#B47792',
          color: '#2D262B',
          weight: 2,
          fillOpacity: 0.95,
        })
          .addTo(this.map!)
          .bindPopup(`<b>${s.stop_name}</b><br>${s.municipality}`);
      });

      if (this.routePolyline) {
        this.map.removeLayer(this.routePolyline);
      }
      this.routePolyline = L.polyline(coords, {
        color: '#B47792',
        weight: 4,
        dashArray: '6, 6',
      }).addTo(this.map);
    } catch {
      // Ignore transient network errors during polling
    }
  }

  async syncBuses(): Promise<void> {
    try {
      const res = await fetch(`${this.serverUrl}/api/buses`);
      const incomingBuses: any[] = await res.json();

      incomingBuses.forEach((b) => {
        const curLat = Number(b.lat);
        const curLng = Number(b.lng);
        const prev = this.busVectors[b.bus_id];

        if (!prev) {
          this.busVectors[b.bus_id] = { lat: curLat, lng: curLng, dLat: 0, dLng: 0 };
        } else if (Math.abs(curLat - prev.lat) > 0.00001 || Math.abs(curLng - prev.lng) > 0.00001) {
          this.busVectors[b.bus_id] = {
            lat: curLat,
            lng: curLng,
            dLat: curLat - prev.lat,
            dLng: curLng - prev.lng,
          };
        }
      });

      this.buses = incomingBuses;
      if (!this.map) return;

      this.buses.forEach((b) => {
        const html = `<div style="background:#B47792;color:#fff;padding:3px 8px;border-radius:10px;font-weight:700;font-size:11px;border:2px solid #FA9EBC;white-space:nowrap;">🚌 ${b.bus_id} (${b.available_seats} seats)</div>`;
        const icon = L.divIcon({
          html,
          className: '',
          iconSize: [120, 24],
          iconAnchor: [60, 12],
        });

        const popupHtml = `<b>${b.bus_id} (${b.plate_number})</b><br>Operator: ${b.operator_name}<br>Driver: ${b.driver_name}<br>Conductor: ${b.conductor_name}<br>Status: ${b.status}`;

        if (this.busMarkers[b.bus_id]) {
          this.busMarkers[b.bus_id].setLatLng([b.lat, b.lng]).setIcon(icon).setPopupContent(popupHtml);
        } else {
          this.busMarkers[b.bus_id] = L.marker([b.lat, b.lng], { icon })
            .addTo(this.map!)
            .bindPopup(popupHtml);
        }
      });
    } catch {
      // Ignore transient network errors during polling
    }
  }

  focusStop(s: any): void {
    this.selectedStopId = s.stop_id;
    if (this.map) {
      this.map.setView([s.lat, s.lng], 14);
    }
  }

  haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
  }

  getPassengerDirectionLabel(): string {
    const origin = this.stops.find((s) => s.stop_id === Number(this.selectedStopId));
    const dest = this.stops.find((s) => s.stop_id === Number(this.destinationStopId));
    if (!origin || !dest || origin.stop_id === dest.stop_id) {
      return 'Select different Origin & Destination';
    }
    return dest.stop_order > origin.stop_order
      ? 'Bound for Cabanatuan City'
      : 'Bound for Bongabon Terminal';
  }

  getPassengerTripDistance(): number {
    const origin = this.stops.find((s) => s.stop_id === Number(this.selectedStopId));
    const dest = this.stops.find((s) => s.stop_id === Number(this.destinationStopId));
    if (!origin || !dest || origin.stop_id === dest.stop_id) return 0;
    return Math.max(0.5, this.haversineKm(origin.lat, origin.lng, dest.lat, dest.lng));
  }

  getPassengerRegularFare(): number {
    const dist = this.getPassengerTripDistance();
    if (dist === 0) return 0;
    return 15.0 + Math.max(0, dist - 4.0) * 2.2;
  }

  computeEtaBadge(b: any): string {
    const origin = this.stops.find((s) => s.stop_id === Number(this.selectedStopId)) || this.stops[0];
    const dest = this.stops.find((s) => s.stop_id === Number(this.destinationStopId));
    if (!origin) return 'Calculating...';

    const curLat = Number(b.lat);
    const curLng = Number(b.lng);
    const stopLat = Number(origin.lat);

    const dist = this.haversineKm(curLat, curLng, stopLat, Number(origin.lng));

    if (dist <= 0.15) {
      return `At ${origin.stop_name} now`;
    }

    const passengerGoingSouth = !dest || dest.stop_order >= origin.stop_order;
    const busIsSouthOfOrigin = curLat < stopLat - 0.0012;
    const busIsNorthOfOrigin = curLat > stopLat + 0.0012;

    const vec = this.busVectors[b.bus_id];
    const hasMoved = vec && (Math.abs(vec.dLat) > 0.00001 || Math.abs(vec.dLng) > 0.00001);

    if (hasMoved) {
      const busGoingSouth = vec.dLat < 0;
      if (dest && origin.stop_id !== dest.stop_id && busGoingSouth !== passengerGoingSouth) {
        const oppositeLabel = busGoingSouth ? 'Bound for Cabanatuan' : 'Bound for Bongabon';
        return `Opposite Direction (${oppositeLabel} • ${dist.toFixed(1)} km away)`;
      }
    }

    if ((passengerGoingSouth && busIsSouthOfOrigin) || (!passengerGoingSouth && busIsNorthOfOrigin)) {
      return `Already Passed ${origin.stop_name} (${dist.toFixed(1)} km downstream)`;
    }

    const mins = Math.max(1, Math.round((dist / 28.0) * 60));
    const dirTag = passengerGoingSouth ? 'Bound for Cabanatuan' : 'Bound for Bongabon';
    return `Arriving in ~${mins} mins (${dist.toFixed(1)} km away • ${dirTag})`;
  }

  getSortedBuses(): any[] {
    if (!this.buses) return [];
    const origin = this.stops.find((s) => s.stop_id === Number(this.selectedStopId)) || this.stops[0];
    const dest = this.stops.find((s) => s.stop_id === Number(this.destinationStopId));
    if (!origin) return this.buses;

    const passengerGoingSouth = !dest || dest.stop_order >= origin.stop_order;

    return [...this.buses].sort((a, b) => {
      const curLatA = Number(a.lat);
      const curLatB = Number(b.lat);
      const stopLat = Number(origin.lat);

      const aPassed = (passengerGoingSouth && curLatA < stopLat - 0.0012) || (!passengerGoingSouth && curLatA > stopLat + 0.0012);
      const bPassed = (passengerGoingSouth && curLatB < stopLat - 0.0012) || (!passengerGoingSouth && curLatB > stopLat + 0.0012);

      if (aPassed !== bPassed) {
        return aPassed ? 1 : -1;
      }

      const distA = this.haversineKm(curLatA, Number(a.lng), stopLat, Number(origin.lng));
      const distB = this.haversineKm(curLatB, Number(b.lng), stopLat, Number(origin.lng));
      return distA - distB;
    });
  }

  async submitFeedback(): Promise<void> {
    if (!this.fbMessage.trim()) return;
    await fetch(`${this.serverUrl}/api/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bus_id: this.fbBusId,
        user_id: this.loggedInUser?.user_id || null,
        passenger_name: this.loggedInUser?.full_name || 'Commuter',
        category: this.fbCategory,
        message: this.fbMessage,
      }),
    });
    this.fbMessage = '';
    this.fbStatus = 'Thank you! Your report was sent to the Cooperative Dispatcher.';
  }
}