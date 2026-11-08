"use client";
import {createContext,useContext} from 'react';

/** Pages refresh normally. An embedded booking opens current details as a new chat card. */
export const BookingRefreshContext=createContext<(()=>void)|null>(null);
export const useBookingRefresh=()=>useContext(BookingRefreshContext);
