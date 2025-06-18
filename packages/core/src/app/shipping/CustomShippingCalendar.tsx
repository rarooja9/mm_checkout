import React, { useState, useEffect } from 'react';

interface ShippingCalendarSelectorProps {
  onSelectShippingOption: (option: any) => void;
  onSelectDeliveryDate: (date: Date) => void;
  calendarData: any;
  selectedShippingOption: any;
  currentConsignment: any;
  product: any;
  selectedShippingDate: Date | null;
  isLoading: boolean;
}

const ShippingCalendarSelector: React.FC<ShippingCalendarSelectorProps> = ({
  onSelectShippingOption,
  onSelectDeliveryDate,
  selectedShippingOption,
  selectedShippingDate,
  currentConsignment,
  product,
  isLoading
}) => {
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth());
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [showModal, setShowModal] = useState<boolean>(false);
  const [selectedDayMethods, setSelectedDayMethods] = useState<any[]>([]);
  const [selectedDateString, setSelectedDateString] = useState<string>("");
  const [selectedDayObject, setSelectedDayObject] = useState<Date | null>(null);
  const [loadingMethods, setLoadingMethods] = useState<boolean>(false);
  const [methodsCache, setMethodsCache] = useState<Map<string, any[]>>(new Map());
  const [availableDates, setAvailableDates] = useState<Date[]>([]);

  // Initialize available dates (75 days from now)
  useEffect(() => {
    const dates: Date[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 0; i < 75; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() + i);
      dates.push(date);
    }
    setLoadingMethods(false);
    setAvailableDates(dates);
  }, []);

  const getDaysInMonth = (year: number, month: number) => {
    return new Date(year, month + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (year: number, month: number) => {
    return new Date(year, month, 1).getDay();
  };

  const isDateAvailable = (date: Date) => {
    const dateString = date.toDateString();
    return availableDates.some(availableDate => availableDate.toDateString() === dateString);
  };

  const getCachedMethods = (date: Date): any[] | undefined => {
    const dateKey = date.toISOString().split('T')[0];
    return methodsCache.get(dateKey);
  };

  const onLoadMethods = async (date: Date) => {
    try {
      // Format date as MM/DD/YYYY
      const formattedDate = `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}/${date.getFullYear()}`;

      // Get shipping address from currentConsignment
      const shippingAddress = currentConsignment?.shippingAddress;
      if (!shippingAddress) {
        throw new Error('No shipping address found');
      }

      // Try to get product options from session storage first
      let productOptions = sessionStorage.getItem(product.productId);
      let parsedOptions = productOptions ? JSON.parse(productOptions) : null;

      // If not in session, fetch from API
      if (!parsedOptions) {
        const optionsResponse = await fetch('https://bc-middleware-mm.onrender.com/cart/get-options', {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            itemId: [product.productId]
          })
        });

        if (!optionsResponse.ok) {
          throw new Error('Failed to fetch product options');
        }

        const optionsData = await optionsResponse.json();
        parsedOptions = optionsData[product.productId] || {};

        // Store in session for future use
        sessionStorage.setItem(product.productId, JSON.stringify(parsedOptions));
      }

      // Build the request body
      const requestBody = {
        ratingInfo: {
          requestedOptions: {
            selectedDate: formattedDate
          },
          cart: {
            items: [
              {
                itemId: String(product.productId),
                sku: product.sku,
                weight: parsedOptions.weight || product.weight || 0,
                qty: product.quantity || 1,
                type: "SIMPLE",
                attributes: [
                  {
                    name: "shipperhq_shipping_group",
                    value: parsedOptions.shippingGroup ? parsedOptions.shippingGroup.join(',') : ""
                  },
                  {
                    name: "shipperhq_shipping_fee",
                    value: String(parsedOptions.shippingRate || 0)
                  }
                ]
              }
            ]
          },
          destination: {
            country: shippingAddress.countryCode || "US",
            region: shippingAddress.stateOrProvinceCode || shippingAddress.stateOrProvince,
            city: shippingAddress.city,
            zipcode: shippingAddress.postalCode,
            street: shippingAddress.address1
          },
          customer: {
            customerGroup: "Retail"
          },
          cartType: "STD"
        }
      };

      const response = await fetch('https://bc-middleware-mm.onrender.com/get-methods', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch shipping methods: ${response.status}`);
      }

      const methodsData = await response.json();

      // Get available shipping options from currentConsignment
      const availableOptions = currentConsignment?.availableShippingOptions || [];

      // Match and filter methods based on availableShippingOptions
      const filteredMethods = availableOptions.map((option: any) => {
        // Find matching method from API response using flexible string matching
        const matchingMethod = methodsData.find((method: any) => {
          const optionDesc = option.description.toLowerCase();
          const methodTitle = method.methodTitle.toLowerCase();

          return optionDesc.includes(methodTitle) || methodTitle.includes(optionDesc);
        });

        // Return the available option enhanced with delivery dates
        return {
          code: option.id,
          method: option.description,
          totalCharges: option.cost,
          deliveryDate: matchingMethod?.deliveryDate || null,
          dispatchDate: matchingMethod?.dispatchDate || null,
          isRecommended: option.isRecommended || false
        };
      }).filter((method: any) => method.deliveryDate !== null); // Only include methods that have matching delivery dates

      return filteredMethods;

    } catch (error) {
      console.error('Error loading shipping methods:', error);
      return [];
    }
  }

  const handleLoadMethods = async (date: Date) => {
    const cachedMethods = getCachedMethods(date);

    if (cachedMethods) {
      // If we have cached methods, show them immediately
      setSelectedDayMethods(cachedMethods);
      setSelectedDateString(date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      }));
      setSelectedDayObject(date);
      setShowModal(true);
      return;
    }

    // Otherwise, load methods
    setLoadingMethods(true);
    setSelectedDateString(date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    }));
    setSelectedDayObject(date);
    setShowModal(true);

    try {
      const methods = await onLoadMethods(date);
      setSelectedDayMethods(methods);

      // Cache the methods
      const dateKey = date.toISOString().split('T')[0];
      setMethodsCache(prev => new Map(prev).set(dateKey, methods));
    } catch (error) {
      console.error('Error loading methods:', error);
      setSelectedDayMethods([]);
    } finally {
      setLoadingMethods(false);
    }
  };

  const handlePrevMonth = (e: React.MouseEvent) => {
    e.stopPropagation();

    setSelectedMonth(prevMonth => {
      if (prevMonth === 0) {
        setSelectedYear(prevYear => prevYear - 1);
        return 11;
      }
      return prevMonth - 1;
    });
  };

  const handleNextMonth = (e: React.MouseEvent) => {
    e.stopPropagation();

    setSelectedMonth(prevMonth => {
      if (prevMonth === 11) {
        setSelectedYear(prevYear => prevYear + 1);
        return 0;
      }
      return prevMonth + 1;
    });
  };

  const handleMethodSelect = (method: any) => {
    const option = {
      id: method.code,
      description: method.method,
      cost: method.totalCharges,
      deliveryDate: method.deliveryDate,
      dispatchDate: method.dispatchDate
    };

    onSelectShippingOption(option);

    if (selectedDayObject) {
      onSelectDeliveryDate(selectedDayObject);
    }

    setShowModal(false);
  };

  const renderCalendar = () => {
    if (isLoading) {
      return (
        <div className="tt-loading">
          <div>Loading calendar...</div>
        </div>
      );
    }

    const daysInMonth = getDaysInMonth(selectedYear, selectedMonth);
    const firstDayOfMonth = getFirstDayOfMonth(selectedYear, selectedMonth);

    const days = [];

    // Empty cells for days before the first of the month
    for (let i = 0; i < firstDayOfMonth; i++) {
      days.push(<div key={`empty-${i}`} className="tt-day-empty"></div>);
    }

    // Calendar days
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(selectedYear, selectedMonth, day);
      const isAvailable = isDateAvailable(date);
      const isToday = date.toDateString() === new Date().toDateString();
      const isSelectedDate = selectedShippingDate &&
        date.getDate() === selectedShippingDate.getDate() &&
        date.getMonth() === selectedShippingDate.getMonth() &&
        date.getFullYear() === selectedShippingDate.getFullYear();
      const cachedMethods = getCachedMethods(date);

      days.push(
        <div
          key={day}
          className={`tt-day ${isToday ? 'tt-day-today' : ''} ${isSelectedDate ? 'tt-day-selected' : ''} ${!isAvailable ? 'tt-day-disabled' : ''}`}
        >
          <div className="tt-day-header">
            <span className="tt-day-number">{day}</span>
          </div>
          <div className="tt-method-list">
            {isAvailable && (
              <div className="tt-method-item">
                {cachedMethods ? (
                  <span
                    className="tt-cached-methods"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleLoadMethods(date);
                    }}
                  >
                    {cachedMethods.length} {cachedMethods.length === 1 ? 'option' : 'options'}
                  </span>
                ) : (
                  <button
                    className="tt-load-methods-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleLoadMethods(date);
                    }}
                    type="button"
                  >
                    Load Methods
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      );
    }

    return days;
  };

  return (
    <div className="shipping-calendar-container">
      <div className="tt-header">
        <div className="tt-title-container">
          <h3 className="tt-title">Select Estimated Delivery Date</h3>
        </div>
        <div className="tt-nav">
          <button
            onClick={handlePrevMonth}
            className="tt-nav-button"
            type="button"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"></polyline>
            </svg>
          </button>
          <span className="tt-month-year">
            {new Date(selectedYear, selectedMonth).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
          </span>
          <button
            onClick={handleNextMonth}
            className="tt-nav-button"
            type="button"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
          </button>
        </div>
      </div>

      <div className="tt-weekdays">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
          <div key={day} className="tt-weekday">
            {day}
          </div>
        ))}
      </div>

      <div className="tt-grid">
        {renderCalendar()}
      </div>

      {selectedShippingOption && selectedShippingDate && (
        <div className="selected-shipping-container">
          <div className="selected-shipping-info">
            <div>
              <div className="selected-shipping-label">Selected Delivery Method:</div>
              <div className="selected-shipping-value">{selectedShippingOption.description} - ${selectedShippingOption.cost.toFixed(2)}</div>
            </div>
            <div>
              <div className="selected-shipping-label">Selected Estimated Delivery Date:</div>
              <div className="selected-shipping-value">
                {selectedShippingDate.toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric'
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal for showing shipping methods */}
      {showModal && (
        <div className="tt-modal-overlay" onClick={() => setShowModal(false)}>
          <div className="tt-modal" onClick={(e) => e.stopPropagation()}>
            <div className="tt-modal-header">
              <h3 className="tt-modal-title">
                {selectedDateString} Estimated Delivery Options
              </h3>
              <button
                onClick={() => setShowModal(false)}
                className="tt-close-button"
                type="button"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
            <div className="tt-modal-body">
              {loadingMethods ? (
                <div className="tt-loading-methods">
                  <div className="tt-spinner"></div>
                  <p>Loading delivery methods...</p>
                </div>
              ) : selectedDayMethods.length > 0 ? (
                selectedDayMethods.map((method, idx) => (
                  <div
                    key={idx}
                    className={`tt-method-card ${selectedShippingOption && method.code === selectedShippingOption.id ? 'tt-method-card-selected' : ''
                      }`}
                    onClick={() => handleMethodSelect(method)}
                  >
                    <div className="tt-method-card-header">
                      <span className="tt-method-name">{method.method}</span>
                      <span className="tt-method-price">
                        ${method.totalCharges.toFixed(2)}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="tt-no-methods">
                  <p>No delivery methods available for this date.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ShippingCalendarSelector;