const newAppointmentsSub = "NEW_APPOINTMENTS";
const newQuotesSub = "NEW_QUOTES";
const newVehiclesSub = "NEW_VEHICLES";

const { PostgresPubSub } = require("graphql-postgres-subscriptions");
const { Client } = require("pg");

const client = new Client();
client.connect();
const pubsub = new PostgresPubSub({ client });

pubsub.subscribe("error", console.error);

const { withFilter } = require("apollo-server");

exports.resolvers = {
	Query: {
		customers: (root, args, context, info) => {
			return context.prisma.customer.findMany();
		},

		customer: async (root, args, context, info) => {
			console.log(args);

			if (args.id) {
				return context.prisma.customer.findUnique({
					where: {
						id: args.id,
					},
					include: {
						vehicles: true,
					},
				});
			}

			if (args.email && args.password) {
				try {
					const existingCustomer = await context.prisma.customer.findUnique({
						where: {
							email: args.email,
						},
					});
					console.log(existingCustomer);

					if (existingCustomer.password === args.password) {
						return existingCustomer;
					} else {
						throw new Error("Invalid login credentials");
					}
				} catch (e) {
					console.error(e);
					throw new Error("Invalid login credentials");
				}
			}
		},

		appointments: async (root, args, context, info) => {
			let appointment = await context.prisma.appointment.findMany({
				where: {
					customerID: args.customerID,
				},

				include: {
					quote: {
						include: {
							vehicle: true,
							billItems: {
								include: {
									service: true,
									part: true,
								},
							},
						},
					},
					mechanic: true,
				},
			});

			return appointment;
		},

		vehicle: (root, args, context, info) => {
			return context.prisma.vehicle.findUnique({
				where: {
					id: args.id,
				},
			});
		},

		customerProfile: (root, args, context, info) => {
			return context.prisma.customer.findUnique({
				where: {
					id: args.id,
				},
			});
		},

		vehicles: (root, args, context, info) => {
			return context.prisma.vehicle.findMany({
				where: {
					customerID: args.customerID,
				},
			});
		},

		services: async (root, args, context, info) => {
			if (args.servicesList) {
				let serviceRecordsList = [];

				for (let service of args.servicesList) {
					let serviceRecord = await context.prisma.service.findUnique({
						where: {
							id: service,
						},
					});
					serviceRecordsList.push(serviceRecord);
				}
				return serviceRecordsList;
			}

			return context.prisma.service.findMany({
				include: {
					parts: true
				}
			});
		},

		parts: async (root, args, context, info) => {
			let partRecordsList = [];

			for (let item of args.partsList) {
				let record = await context.prisma.part.findUnique({
					where: {
						id: item,
					},
				});
				partRecordsList.push(record);
			}
			return partRecordsList;
		},

		quotes: (root, args, context, info) => {
			return context.prisma.quote.findMany({
				where: {
					customerID: args.customerID,
				},

				include: {
					vehicle: true,
					billItems: {
						include: {
							service: true,
							part: true,
						},
					},
				},
			});
		},
		appointment: (root, args, context, info) => {
			return context.prisma.appointment.findUnique({
				where: {
					id: args.appointmentID,
				},

				include: {
					quote: {
						include: {
							vehicle: true,
							billItems: {
								include: {
									service: true,
									part: true,
								},
							},
						},
					},
					mechanic: true,
				},
			});
		},
	},
	Mutation: {
		createCustomer: async (root, args, context) => {
			console.log("creating customer");
			const existingCustomer = await context.prisma.customer.findUnique({
				where: {
					email: args.email,
				},
			});

			if (existingCustomer) {
				throw new Error(
					`The email ${args.email} is already attached to an account`
				);
			}

			try {
				pubsub.publish(newCustomerSub, {
					newCustomer: {
						phone: args.phone,
						email: args.email,
						password: args.password,
					},
				});
			} catch (e) {
				console.error(e);
			}

			return context.prisma.customer.create({
				data: {
					phone: args.phone,
					email: args.email,
					password: args.password,
				},
			});
		},

		updateCustomer: (root, args, context) => {
			return context.prisma.customer.update({
				where: {
					id: args.id,
				},
				data: {
					firstName: args.firstName,
					lastName: args.lastName,
					phone: args.phone,
					email: args.email,
					password: args.password,
					streetAddress1: args.streetAddress1,
					streetAddress2: args.streetAddress2,
					city: args.city,
					state: args.state,
					zipcode: args.zipcode,
				},
			});
		},

		createAppointment: async (root, args, context) => {
			console.log("received createAppointment request");
			const newAppointment = await context.prisma.appointment.create({
				data: {
					customerID: args.customerID,
					quoteID: args.quoteID,
					scheduleDate: args.scheduleDate,
					address: args.address,
					status: args.status,
				},
			});

			// console.log("New Appointment: ", newAppointment);

			try {
				const appointmentQuote = await context.prisma.quote.findUnique({
					where: {
						id: args.quoteID,
					},
					include: {
						vehicle: true,
						services: true,
					},
				});
				newAppointment.quote = appointmentQuote;
				pubsub.publish(newAppointmentsSub, {
					newAppointment: newAppointment,
				});
			} catch (e) {
				console.error(e);
			}

			return newAppointment;
		},

		createQuote: async (root, args, context) => {
			const newQuote = await context.prisma.quote.create({
				data: {
					// createdAt: String(new Date()),
					costEstimate: args.costEstimate,
					customer: { connect: { id: args.customerID } },
					status: args.status,
					vehicle: { connect: { id: args.vehicleID } },
					billItems: { create: args.billItems.map((s)=>({
							serviceID: s.serviceID,
							partID: s.partID, 
							cost: s.cost,
						}))
					},
					// services: { connect: args.services.map((s) => ({ id: s })) },
				},
			});

			// console.log("newQuote: ", newQuote);

			try {
				const retrievedQuote = await context.prisma.quote.findUnique({
					where: {
						id: newQuote.id,
					},
					include: {
						vehicle: true,
						billItems: {
							include: {
								service: true,
								part: true,
							}
						},
					},
				});
				pubsub.publish(newQuotesSub, {
					newQuote: retrievedQuote,
				});
			} catch (e) {
				console.error(e);
			}

			return newQuote;
		},

		createVehicle: async (root, args, context) => {
			console.log("received create vehicle request");

			const newVehicle = await context.prisma.vehicle.create({
				data: {
					customerID: args.customerID,
					vin: args.vin,
					vehicleType: args.vehicleType,
					year: args.year,
					make: args.make,
					model: args.model,
				},
			});

			try {
				pubsub.publish(newVehiclesSub, {
					newVehicle: newVehicle,
				});
			} catch (e) {
				console.error(e);
			}

			return newVehicle;
		},

		updateAppointment: async (root, args, context) => {
			const updatedAppointment = await context.prisma.appointment.update({
				where: {
					id: args.id,
				},
				data: {
					status: args.status,
				},
			});

			try {
				const appointmentQuote = await context.prisma.quote.findUnique({
					where: {
						id: updatedAppointment.quoteID,
					},
					include: {
						vehicle: true,
						services: true,
					},
				});
				updatedAppointment.quote = appointmentQuote;
				pubsub.publish(newAppointmentsSub, {
					newAppointment: updatedAppointment,
				});
			} catch (e) {
				console.error(e);
			}

			return updatedAppointment;
		},

		createTransaction: async (root, args, context) => {
			return context.prisma.transaction.create({
				data: {
					appointmentID: args.appointmentID,
					cost: args.cost,
				},
			});
		},
	},

	Subscription: {
		newAppointment: {
			subscribe: withFilter(
				() => pubsub.asyncIterator(newAppointmentsSub),
				(payload, variables) => {
					return payload.newAppointment.customerID === variables.customerID;
				}
			),
		},

		newQuote: {
			subscribe: withFilter(
				() => pubsub.asyncIterator(newQuotesSub),
				(payload, variables) => {
					return payload.newQuote.customerID === variables.customerID;
				}
			),
		},

		newVehicle: {
			subscribe: withFilter(
				() => pubsub.asyncIterator(newVehiclesSub),
				(payload, variables) => {
					return payload.newVehicle.customerID === variables.customerID;
				}
			),
		},
	},
};
